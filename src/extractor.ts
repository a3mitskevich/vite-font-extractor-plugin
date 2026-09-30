import type { Plugin, ResolvedConfig, Rollup } from "vite";
import { resolve } from "node:path";
import type { PluginOption } from "./types";
import Cache from "./cache";
import { createResolvers, getHash, intersection, mergePath } from "./utils";
import { CSS_LANGS_RE, PLUGIN_NAME } from "./constants";
import { createInternalLogger } from "./internal-logger";
import { type PluginContext, createPluginContext, getLogger, resetBuildState } from "./context";
import { createCssResolvers } from "./css-candidates";
import { transformFaceSources } from "./css-pre-transform";
import { swapCompiledFaces } from "./css-swap";
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

// Modules vite:css skips: `?raw`, `?url`, workers
const SPECIAL_QUERY_RE = /[?&](?:worker|sharedworker|raw|url)\b/;
const CSS_FILTER = { id: { include: CSS_LANGS_RE, exclude: SPECIAL_QUERY_RE } };
const JS_CODE_FILTER = { id: { exclude: CSS_LANGS_RE }, code: NEW_URL_CODE_RE };

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

function configureContext(ctx: PluginContext, config: ResolvedConfig): void {
  const { pluginOption } = ctx;
  ctx.logger = createInternalLogger(pluginOption.logLevel ?? config.logLevel, config.customLogger);
  const logger = ctx.logger;
  logger.banner();
  if (!pluginOption.type) {
    logger.warn(`type is not set, falling back to "manual"`);
  }
  const cacheStatus = pluginOption.cache ? "cache enabled" : "no cache";
  const targetCount = ctx.targets.length;
  logger.config(ctx.mode, `${targetCount} target${targetCount !== 1 ? "s" : ""}, ${cacheStatus}`);

  const ignoredTargets = intersection(
    pluginOption.ignore ?? [],
    ctx.targets.map((target) => target.fontName),
  );
  if (ignoredTargets.length) {
    logger.warn(`Ignore overlaps with targets: ${ignoredTargets.toString()}`);
  }

  ctx.importResolvers = createResolvers(config);
  ctx.cssResolvers = createCssResolvers(config);
  ctx.root = config.root;
  ctx.base = config.base;
  ctx.publicDir = config.publicDir || null;
  ctx.buildConfig = config.command === "build" ? config.build : null;

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

function configureCache(ctx: PluginContext, config: ResolvedConfig): void {
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
    ctx.mode === "auto" ? waitForGraph(ctx.graph, lookup, id) : Promise.resolve();

// Auto mode: a glyph found after its font was emitted would render as a missing icon
function checkAutoGlyphs(ctx: PluginContext): string | null {
  const used = ctx.autoGlyphSets;
  if (!used.size || (used.size === 1 && used.has(ctx.autoProxyOption.sid))) return null;
  const known = new Set([...used].flatMap((sid) => JSON.parse(sid) as string[]));
  const missing = (ctx.autoProxyOption.target.raws ?? []).filter((glyph) => !known.has(glyph));
  if (!missing.length) return null;
  return (
    `auto mode: CSS content ${missing.map((glyph) => JSON.stringify(glyph)).join(", ")} was found ` +
    "after its font had been emitted" +
    (ctx.graph.timedOut ? " (waiting for the module graph timed out)" : "") +
    ". Add these glyphs to a target of the font."
  );
}

const toInputList = (input: Rollup.NormalizedInputOptions["input"]): string[] =>
  Array.isArray(input) ? input : Object.values(input);

export default function FontExtractor(pluginOption: PluginOption = { type: "auto" }): Plugin[] {
  const ctx = createPluginContext(pluginOption);
  const { apply } = pluginOption;

  const pre: Plugin = {
    name: `${PLUGIN_NAME}:pre`,
    enforce: "pre",
    apply,
    applyToEnvironment: isAppliedTo,
    resolveId: {
      filter: { id: SUBSET_IMPORT_RE },
      async handler(source, importer) {
        // Dev serves `?subset=` imports through the middleware
        if (ctx.isServe) return null;
        return resolveSubsetImport(this, source, importer);
      },
    },
    load: {
      filter: { id: VIRTUAL_ID_RE },
      async handler(id) {
        const code = await loadSubsetImport(this, ctx, id);
        return { code, moduleType: "js", moduleSideEffects: false };
      },
    },
    transform: {
      filter: CSS_FILTER,
      async handler(code, id) {
        if (ctx.isServe) return null;
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
      filter: JS_CODE_FILTER,
      handler(code, id) {
        return rewriteNewUrlSubsets(code, id);
      },
    },
  };

  const main: Plugin = {
    name: PLUGIN_NAME,
    apply,
    applyToEnvironment: isAppliedTo,
    configResolved(config) {
      configureContext(ctx, config);
    },
    configureServer(server) {
      ctx.isServe = true;
      ctx.server = server;
      server.middlewares.use(createServeMiddleware(ctx, server));
    },
    async buildStart(options) {
      resetBuildState(ctx, ctx.isServe ? "" : this.environment.name);
      if (!ctx.isServe) ctx.buildConfig = this.environment.config.build;
      ctx.cachedBefore = getLogger(ctx).cachedCount();
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
        if (ctx.isServe) {
          const served = transformServedCss(ctx, code, id);
          return served === code ? null : served;
        }
        collectContentGlyphs(ctx, code, id);
        const waitForGlyphs = createGlyphWait(ctx, this, id);
        const swapped = await swapCompiledFaces(this, ctx, code, id, waitForGlyphs);
        const current = swapped?.code ?? code;
        if (!hasGoogleFontUrl(current)) return swapped;
        await waitForGlyphs();
        const withGoogle = rewriteCssGoogleFonts(ctx, current, id);
        return withGoogle === current ? swapped : { code: withGoogle, map: null };
      },
    },
    buildEnd() {
      if (ctx.isServe) return;
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
      onModuleParsed(ctx.graph, this, info);
    },
  };

  const htmlPre: Plugin = {
    name: `${PLUGIN_NAME}:html`,
    apply: applyToBuild(apply),
    applyToEnvironment: isAppliedTo,
    transformIndexHtml: {
      order: "pre",
      handler(html, htmlContext) {
        recordPreloadSources(ctx, html, htmlContext.filename);
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
        const withGoogle = hasGoogleFontUrl(html)
          ? rewriteGoogleFontUrls(ctx, html, htmlContext.filename)
          : html;
        if (ctx.isServe || !htmlContext.bundle) return withGoogle;
        // Vite calls it from its own generateBundle, with the bundle's plugin context
        const pluginContext = this as unknown as Pick<Rollup.PluginContext, "getFileName">;
        return redirectFontPreloads(
          ctx,
          withGoogle,
          htmlContext.filename,
          (referenceId) => pluginContext.getFileName(referenceId),
          htmlContext.bundle,
        );
      },
    },
    async generateBundle(_, bundle) {
      removeUnusedOriginals(ctx, bundle, (referenceId) => this.getFileName(referenceId));
      const logger = getLogger(ctx);
      const cached = logger.cachedCount() - ctx.cachedBefore;
      if (ctx.stats.minified || cached) {
        logger.summary({ ...ctx.stats, cached });
      }
      await ctx.cache?.prune();
    },
  };

  return [pre, newUrl, main, ...(ctx.mode === "auto" ? [graph] : []), htmlPre, post];
}
