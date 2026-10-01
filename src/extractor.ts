import {
  createFilter,
  normalizePath,
  type Plugin,
  type ResolvedConfig,
  type Rollup,
  perEnvironmentState,
} from "vite";
import { resolve } from "node:path";
import type { ModuleFilterPattern, PluginOption } from "./types";
import Cache from "./cache";
import { createResolvers, getHash, intersection, mergePath } from "./utils";
import { CSS_LANGS_RE, PLUGIN_NAME } from "./constants";
import { createInternalLogger, isDebugEnabled } from "./internal-logger";
import {
  type PluginContext,
  type SharedContext,
  createEnvironmentContext,
  createPluginContext,
  getLogger,
  resetBuildState,
} from "./context";
import { createCssResolvers } from "./css-candidates";
import { transformFaceSources } from "./css-pre-transform";
import { reportExcludedFaces, swapCompiledFaces } from "./css-swap";
import { addEntries, onModuleParsed, waitForGraph } from "./graph-wait";
import {
  loadSubsetImport,
  NEW_URL_CODE_RE,
  resolveSubsetImport,
  rewriteNewUrlSubsets,
  SUBSET_IMPORT_RE,
  VIRTUAL_ID_RE,
} from "./subset-import";
import { collectContentGlyphs, rewriteCssGoogleFonts, transformServedCss } from "./transform";
import { hasGoogleFontUrl, rewriteGoogleFontUrls } from "./google-rewrite";
import { recordPreloadSources, redirectFontPreloads } from "./html";
import { removeUnusedOriginals } from "./cleanup";
import { createServeMiddleware } from "./serve";
import { onServedFileChange } from "./serve-registry";
import { createReport, emitReport } from "./report";

// Modules vite:css skips: `?raw`, `?url`, workers
const SPECIAL_QUERY_RE = /[?&](?:worker|sharedworker|raw|url)\b/;
const CSS_FILTER = { id: { include: CSS_LANGS_RE, exclude: SPECIAL_QUERY_RE } };

const toPatternList = (pattern: ModuleFilterPattern | undefined): Array<string | RegExp> =>
  pattern === undefined ? [] : Array.isArray(pattern) ? pattern : [pattern];

// Without include/exclude every module counts: createFilter would also drop `\0` virtual ids
function createModuleFilter(
  { include, exclude }: PluginOption,
  root: string,
): (id: string) => boolean {
  if (include === undefined && exclude === undefined) return () => true;
  return createFilter(include, exclude, { resolve: root });
}

/**
 * Hook filters of the hooks that minify: a RegExp of `exclude` is checked natively as well. An
 * include can not be combined with the language filter (a filter's includes are alternatives) and
 * globs are relative to `root`, known only later — the handlers check `isModuleIncluded` for them.
 */
function createMinifyFilters(pluginOption: PluginOption) {
  const excluded = toPatternList(pluginOption.exclude).filter(
    (pattern): pattern is RegExp => pattern instanceof RegExp,
  );
  return {
    css: { id: { include: CSS_LANGS_RE, exclude: [SPECIAL_QUERY_RE, ...excluded] } },
    newUrl: { id: { exclude: [CSS_LANGS_RE, ...excluded] }, code: NEW_URL_CODE_RE },
  };
}

// Builds of every environment minify the same way, so an SSR bundle points at the files the
// client build emits; the dev middleware serves the browser only
const isAppliedTo = (environment: { config: { consumer: string; command: string } }): boolean =>
  environment.config.consumer === "client" || environment.config.command === "build";

// The user's `apply`, narrowed to builds
const applyToBuild =
  (apply: PluginOption["apply"]): Plugin["apply"] =>
  (config, env) => {
    if (env.command !== "build") return false;
    return typeof apply === "function" ? apply(config, env) : apply !== "serve";
  };

function configureContext(ctx: SharedContext, config: ResolvedConfig): void {
  const { pluginOption } = ctx;
  ctx.logger = createInternalLogger(pluginOption.logLevel ?? config.logLevel, config.customLogger, {
    isEnabled: isDebugEnabled(pluginOption.debug),
    root: config.root,
  });
  const logger = ctx.logger;
  logger.banner();
  if (!pluginOption.type) {
    logger.warn(`type is not set, falling back to "manual"`);
  }
  const cacheStatus = pluginOption.cache ? "cache enabled" : "no cache";
  const targetCount = ctx.targets.length;
  logger.config(ctx.mode, `${targetCount} target${targetCount !== 1 ? "s" : ""}, ${cacheStatus}`);
  logger.debug(() => `targets: ${ctx.targets.map((target) => `"${target.fontName}"`).join(", ")}`);

  const ignoredTargets = intersection(
    (pluginOption.ignore ?? []).filter((matcher) => typeof matcher === "string"),
    ctx.targets.filter((target) => !target.match).map((target) => target.fontName),
  );
  if (ignoredTargets.length) {
    logger.warn(`Ignore overlaps with targets: ${ignoredTargets.toString()}`);
  }

  ctx.importResolvers = createResolvers(config);
  ctx.cssResolvers = createCssResolvers(config);
  ctx.isModuleIncluded = createModuleFilter(pluginOption, config.root);
  ctx.root = config.root;
  ctx.base = config.base;
  ctx.publicDir = config.publicDir || null;

  configureCache(ctx, config);
}

// The cache used to live in node_modules; 4.0 keeps it in Vite's cache directory
const LEGACY_CACHE_PARENT = "node_modules";

// One owner per config and command: builds of other configs keep the entries they use
const getCacheOwner = (config: ResolvedConfig): string =>
  getHash(
    JSON.stringify([
      config.root,
      config.configFile,
      config.command,
      config.mode,
      config.build.outDir,
    ]),
  );

function configureCache(ctx: SharedContext, config: ResolvedConfig): void {
  const { cache } = ctx.pluginOption;
  if (cache) {
    const parent = typeof cache === "string" ? resolve(config.root, cache) : config.cacheDir;
    ctx.cache = new Cache(parent, getCacheOwner(config), config.command === "serve");
    return;
  }
  // Clean up a stale cache directory when cache is disabled
  Cache.removeIfExists(config.cacheDir);
  Cache.removeIfExists(mergePath(config.root, LEGACY_CACHE_PARENT));
}

// Auto mode: glyphs are complete once every other module of the graph is transformed
const createGlyphWait =
  (ctx: PluginContext, lookup: Pick<Rollup.PluginContext, "getModuleInfo">, id: string) =>
  (): Promise<void> =>
    ctx.mode === "auto"
      ? waitForGraph(ctx.graph, lookup, id, (message, moduleId) =>
          getLogger(ctx).debug(message, moduleId),
        )
      : Promise.resolve();

// Auto mode: a glyph found after its font was emitted would render as a missing icon
function checkAutoGlyphs(ctx: PluginContext): string | null {
  const used = ctx.autoGlyphSets;
  if (!used.size || (used.size === 1 && used.has(ctx.autoProxyOption.sid))) return null;
  // Every font has to know the glyph: another font minified later with it does not help
  const sets = [...used].map((sid) => new Set(JSON.parse(sid) as string[]));
  const missing = (ctx.autoProxyOption.target.raws ?? []).filter((glyph) =>
    sets.some((set) => !set.has(glyph)),
  );
  if (!missing.length) return null;
  return (
    `auto mode: CSS content ${missing.map((glyph) => JSON.stringify(glyph)).join(", ")} was found ` +
    "after its font had been emitted" +
    (ctx.graph.timedOut ? " (waiting for the module graph timed out)" : "") +
    ". Add these glyphs to a target of the font."
  );
}

// Strict mode: a target no face resolved to would ship its font as it is, if the font is used at
// all. Client builds only: an SSR build often loads no stylesheet
function checkUnmatchedTargets(ctx: PluginContext): string | null {
  const unmatched = ctx.targets.filter((target) => !ctx.matchedTargets.has(target.fontName));
  if (!unmatched.length) return null;
  const names = unmatched.map((target) => `"${target.fontName}"`).join(", ");
  return `Strict mode: target ${names} matched no @font-face or Google Fonts family of the build`;
}

const toInputList = (input: Rollup.NormalizedInputOptions["input"]): string[] =>
  Array.isArray(input) ? input : Object.values(input);

// transformIndexHtml runs within the hooks of vite:build-html, whose context has the environment
const asBuildHookContext = (context: unknown): Rollup.PluginContext =>
  context as Rollup.PluginContext;

function assertReportOption({ report }: PluginOption): void {
  if (report === undefined || (typeof report === "string" && report.trim())) return;
  throw new Error("[vite-font-extractor-plugin] `report` must be a file path");
}

export default function FontExtractor(pluginOption: PluginOption = { type: "auto" }): Plugin[] {
  assertReportOption(pluginOption);
  const shared = createPluginContext(pluginOption);
  const { apply } = pluginOption;
  const filters = createMinifyFilters(pluginOption);
  // Builds of a builder may run in parallel (client and SSR): each environment has its own build
  // state, so a buildStart never resets another build. Dev keeps the state of the shared context.
  // No `sharedDuringBuild`: a shared instance gets configResolved for the config of every
  // environment, the last one wins the logger, resolvers and cache (its owner has the outDir)
  const environmentContext = perEnvironmentState((environment) =>
    createEnvironmentContext(shared, environment.name, environment.config.build),
  );
  const contextOf = (hookContext: Rollup.PluginContext): PluginContext =>
    shared.isServe ? shared : environmentContext(hookContext);

  const pre: Plugin = {
    name: `${PLUGIN_NAME}:pre`,
    enforce: "pre",
    apply,
    applyToEnvironment: isAppliedTo,
    resolveId: {
      filter: { id: SUBSET_IMPORT_RE },
      async handler(source, importer) {
        // Dev serves `?subset=` imports through the middleware
        if (shared.isServe || (importer && !shared.isModuleIncluded(importer))) return null;
        return resolveSubsetImport(this, shared, source, importer);
      },
    },
    load: {
      filter: { id: VIRTUAL_ID_RE },
      async handler(id) {
        const code = await loadSubsetImport(this, contextOf(this), id);
        return { code, moduleType: "js", moduleSideEffects: false };
      },
    },
    transform: {
      filter: filters.css,
      async handler(code, id) {
        if (shared.isServe || !shared.isModuleIncluded(id)) return null;
        const ctx = contextOf(this);
        ctx.rawSources.set(id, code);
        return transformFaceSources(this, ctx, code, id);
      },
    },
  };

  const newUrl: Plugin = {
    name: `${PLUGIN_NAME}:new-url`,
    enforce: "pre",
    apply: applyToBuild(apply),
    applyToEnvironment: isAppliedTo,
    transform: {
      filter: filters.newUrl,
      handler(code, id) {
        if (!shared.isModuleIncluded(id)) return null;
        return rewriteNewUrlSubsets(shared, code, id);
      },
    },
  };

  const main: Plugin = {
    name: PLUGIN_NAME,
    apply,
    applyToEnvironment: isAppliedTo,
    configResolved(config) {
      configureContext(shared, config);
    },
    configureServer(server) {
      shared.isServe = true;
      shared.server = server;
      server.middlewares.use(createServeMiddleware(shared, server));
    },
    async buildStart(options) {
      const ctx = contextOf(this);
      resetBuildState(ctx);
      if (ctx.isServe || ctx.mode !== "auto") return;
      const resolved = await Promise.all(
        toInputList(options.input).map((input) => this.resolve(input)),
      );
      addEntries(
        ctx.graph,
        resolved.flatMap((entry) => (entry ? [entry.id] : [])),
      );
    },
    transform: {
      filter: CSS_FILTER,
      async handler(code, id) {
        const ctx = contextOf(this);
        if (ctx.isServe) {
          const served = transformServedCss(ctx, code, id);
          return served === code ? null : served;
        }
        // Auto glyphs come from every stylesheet, `include`/`exclude` scope only the fonts
        collectContentGlyphs(ctx, code, id);
        if (!ctx.isModuleIncluded(id)) {
          getLogger(ctx).debug("L2: outside include/exclude — fonts left as they are", id);
          reportExcludedFaces(ctx, code, id);
          return null;
        }
        const waitForGlyphs = createGlyphWait(ctx, this, id);
        const swapped = await swapCompiledFaces(this, ctx, code, id, waitForGlyphs);
        const current = swapped?.code ?? code;
        if (!hasGoogleFontUrl(current)) return swapped;
        await waitForGlyphs();
        const withGoogle = rewriteCssGoogleFonts(ctx, current, id);
        return withGoogle === current ? swapped : { code: withGoogle, map: null };
      },
    },
    watchChange(file, change) {
      if (shared.isServe) onServedFileChange(shared, normalizePath(file), change.event);
    },
    buildEnd() {
      if (shared.isServe) return;
      const ctx = contextOf(this);
      const problem = checkAutoGlyphs(ctx);
      // An aborted build must not keep a waiting module or its timer alive
      ctx.graph.reset();
      if (problem) this.error(problem);
    },
  };

  // moduleParsed has no hook filter: Rolldown calls it for every module, so it exists only where
  // it is needed — auto-mode builds
  const graph: Plugin = {
    name: `${PLUGIN_NAME}:graph`,
    apply: applyToBuild(apply),
    applyToEnvironment: isAppliedTo,
    moduleParsed(info) {
      onModuleParsed(contextOf(this).graph, this, info);
    },
  };

  const htmlPre: Plugin = {
    name: `${PLUGIN_NAME}:html`,
    apply: applyToBuild(apply),
    applyToEnvironment: isAppliedTo,
    transformIndexHtml: {
      order: "pre",
      handler(html, htmlContext) {
        recordPreloadSources(contextOf(asBuildHookContext(this)), html, htmlContext.filename);
      },
    },
  };

  const post: Plugin = {
    name: `${PLUGIN_NAME}:post`,
    enforce: "post",
    apply,
    applyToEnvironment: isAppliedTo,
    transformIndexHtml: {
      order: "post",
      handler(html, htmlContext) {
        // Vite calls it from its own generateBundle, with the bundle's plugin context
        const pluginContext = asBuildHookContext(this);
        const ctx = contextOf(pluginContext);
        const withGoogle = hasGoogleFontUrl(html)
          ? rewriteGoogleFontUrls(ctx, html, { file: htmlContext.filename, moduleId: "" })
          : html;
        if (ctx.isServe || !htmlContext.bundle) return withGoogle;
        return redirectFontPreloads(
          ctx,
          withGoogle,
          htmlContext.filename,
          (referenceId) => pluginContext.getFileName(referenceId),
          htmlContext.bundle,
        );
      },
    },
    async generateBundle(outputOptions, bundle) {
      const ctx = contextOf(this);
      // After Vite's HTML plugin: Google Fonts urls of HTML resolve their targets there
      if (pluginOption.strict && this.environment.config.consumer === "client") {
        const unmatched = checkUnmatchedTargets(ctx);
        if (unmatched) this.error(unmatched);
      }
      removeUnusedOriginals(ctx, bundle, (referenceId) => this.getFileName(referenceId));
      // After the cleanup: the report lists only fonts of the output, and it is not a font
      if (pluginOption.report) {
        const outDir = outputOptions.dir ?? resolve(ctx.root, ctx.buildConfig?.outDir ?? "dist");
        const report = createReport(ctx, this.environment.name, bundle);
        await emitReport(this, pluginOption.report, outDir, report);
      }
      // Counted per environment: a parallel build's summary has only its own fonts
      if (ctx.stats.minified || ctx.stats.cached) {
        getLogger(ctx).summary(ctx.stats);
      }
      await ctx.cache?.prune(ctx.environmentName);
    },
  };

  return [pre, newUrl, main, ...(shared.mode === "auto" ? [graph] : []), htmlPre, post];
}
