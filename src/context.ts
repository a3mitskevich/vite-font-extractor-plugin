import type { ResolvedBuildOptions, ViteDevServer } from "vite";
import type Cache from "./cache";
import type {
  ImportResolvers,
  InternalLogger,
  MinifyStats,
  OptionsWithCacheSid,
  PluginOption,
  ServeFontStubResponse,
  IconTarget,
  Target,
  TargetOptionsMap,
} from "./types";
import type { CssResolvers } from "./css-candidates";
import { createGraphState, type GraphState } from "./graph-wait";

// A minified font emitted by the plugin
export interface EmittedFont {
  file: string;
  // Output file name, known as soon as the asset is emitted
  fileName: string;
  // Emitted for a url without `?subset=` — the result an HTML preload of the file follows
  isPlain: boolean;
}

export interface MinifiedSource {
  url: string;
  extension: string;
  source: Buffer;
}

export interface PluginContext {
  readonly mode: PluginOption["type"];
  readonly pluginOption: PluginOption;
  readonly targets: Target[];
  readonly optionsMap: TargetOptionsMap;
  readonly autoProxyOption: OptionsWithCacheSid<IconTarget>;

  cache: Cache | null;
  importResolvers: ImportResolvers | null;
  cssResolvers: CssResolvers | null;
  logger: InternalLogger | null;

  isServe: boolean;
  server: ViteDevServer | null;
  // Dev, auto mode: modules with an auto @font-face, reloaded when the glyphs change
  readonly autoFaceModules: Set<string>;
  autoReloadTimer: NodeJS.Timeout | null;
  root: string;
  // Resolved `config.base`; dev urls carry it and must be stripped before resolving files
  base: string;
  publicDir: string | null;
  // Build options of the environment, null in dev
  buildConfig: ResolvedBuildOptions | null;
  // Auto mode: glyphs of CSS `content` per module id
  readonly glyphsFindMap: Map<string, string[]>;
  readonly fontServeProxy: Map<string, () => Promise<ServeFontStubResponse | null>>;
  // font-family → id of the module that declared it, for the "found in multiple files" warning
  readonly progress: Map<string, string>;

  // Build state, reset on every (re)build
  // CSS module sources before vite:css — imports of a module lead to the fonts it received
  readonly rawSources: Map<string, string>;
  readonly sourceReads: Map<string, Promise<Buffer>>;
  // Minified bytes per source file, keyed by source files + options
  readonly minifications: Map<string, Promise<Map<string, Buffer>>>;
  // Reference id → minified font emitted by the plugin
  readonly emittedFonts: Map<string, EmittedFont>;
  // HTML file → source files its `<link rel="preload">` tags load
  readonly preloadSources: Map<string, Set<string>>;
  // Hashes of data: URLs the plugin inlined minified fonts as
  readonly inlinedFonts: Set<string>;
  // Reference ids emitted only to find which source file an asset of Vite was read from
  readonly probeAssets: Set<string>;
  readonly graph: GraphState;
  // Auto mode: glyph sets (option sids) fonts were minified with, checked in buildEnd
  readonly autoGlyphSets: Set<string>;
  readonly stats: MinifyStats;
  isMinifyPhaseLogged: boolean;
  // Logger's cached count when the build started, the summary reports the difference
  cachedBefore: number;
  reportMinified(fontName: string, fonts: MinifiedSource[], minified: Map<string, Buffer>): void;
}

export function getLogger(ctx: PluginContext): InternalLogger {
  if (!ctx.logger) {
    throw new Error(
      "[vite-font-extractor-plugin] Logger not initialized. configResolved not called yet.",
    );
  }
  return ctx.logger;
}

export function getResolvers(ctx: PluginContext): ImportResolvers {
  if (!ctx.importResolvers) {
    throw new Error(
      "[vite-font-extractor-plugin] Import resolvers not initialized. configResolved not called yet.",
    );
  }
  return ctx.importResolvers;
}

export function getCssResolvers(ctx: PluginContext): CssResolvers {
  if (!ctx.cssResolvers) {
    throw new Error(
      "[vite-font-extractor-plugin] CSS resolvers not initialized. configResolved not called yet.",
    );
  }
  return ctx.cssResolvers;
}

function createAutoTarget(glyphsFindMap: Map<string, string[]>): IconTarget {
  return {
    get fontName(): string {
      throw new Error("Illegal access. Font name must be provided from another place");
    },
    // Sorted: the order modules are transformed in must not change the result
    get raws(): string[] {
      return [...new Set(Array.from(glyphsFindMap.values()).flat())].sort();
    },
    ligatures: [],
  };
}

function createAutoOption(autoTarget: IconTarget): OptionsWithCacheSid<IconTarget> {
  return {
    get sid(): string {
      return JSON.stringify(autoTarget.raws);
    },
    target: autoTarget,
    auto: true,
  };
}

// Options removed from targets, with what replaces them
const REMOVED_TARGET_OPTIONS: Record<string, string> = {
  withWhitespace:
    'fontext 2 no longer adds a space glyph — add " " to `characters` (subset engine)',
};

function assertTargets(targets: Target[]): void {
  for (const target of targets) {
    for (const [option, replacement] of Object.entries(REMOVED_TARGET_OPTIONS)) {
      if (option in target) {
        throw new Error(
          `[vite-font-extractor-plugin] Target "${target.fontName}": \`${option}\` was removed in 4.0: ${replacement}`,
        );
      }
    }
  }
}

export function createPluginContext(pluginOption: PluginOption): PluginContext {
  const mode: PluginOption["type"] = pluginOption.type ?? "manual";

  const glyphsFindMap = new Map<string, string[]>();
  const autoTarget = createAutoTarget(glyphsFindMap);
  const autoProxyOption = createAutoOption(autoTarget);

  const targets = pluginOption.targets
    ? Array.isArray(pluginOption.targets)
      ? pluginOption.targets
      : [pluginOption.targets]
    : [];
  assertTargets(targets);

  const casualOptionsMap = new Map<string, OptionsWithCacheSid>(
    targets.map((target) => [
      target.fontName,
      { sid: JSON.stringify(target), target, auto: false },
    ]),
  );

  const optionsMap: TargetOptionsMap = {
    get: (key: string) => {
      const option = casualOptionsMap.get(key);
      return mode === "auto" ? (option ?? autoProxyOption) : option;
    },
    has: (key: string) => mode === "auto" || casualOptionsMap.has(key),
  };

  const ctx: PluginContext = {
    mode,
    pluginOption,
    targets,
    optionsMap,
    autoProxyOption,
    cache: null,
    importResolvers: null,
    cssResolvers: null,
    logger: null,
    isServe: false,
    server: null,
    autoFaceModules: new Set(),
    autoReloadTimer: null,
    root: process.cwd(),
    base: "/",
    publicDir: null,
    buildConfig: null,
    glyphsFindMap,
    fontServeProxy: new Map(),
    progress: new Map(),
    rawSources: new Map(),
    sourceReads: new Map(),
    minifications: new Map(),
    emittedFonts: new Map(),
    inlinedFonts: new Set(),
    preloadSources: new Map(),
    probeAssets: new Set(),
    graph: createGraphState(),
    autoGlyphSets: new Set(),
    stats: { minified: 0, cached: 0, saved: 0 },
    isMinifyPhaseLogged: false,
    cachedBefore: 0,
    reportMinified: (fontName, fonts, minified) => reportMinified(ctx, fontName, fonts, minified),
  };
  return ctx;
}

function reportMinified(
  ctx: PluginContext,
  fontName: string,
  fonts: MinifiedSource[],
  minified: Map<string, Buffer>,
): void {
  const logger = getLogger(ctx);
  logger.found("Font", fontName, `${fonts.length} format${fonts.length !== 1 ? "s" : ""}`);
  fonts.forEach((font, index) => {
    const result = minified.get(font.url);
    if (!result) {
      logger.skipped(fontName, `${font.extension} was not minified — keeping original`);
      return;
    }
    ctx.stats.minified++;
    ctx.stats.saved += font.source.length - result.length;
    logger.minified(
      fontName,
      font.extension,
      font.source.length,
      result.length,
      index === fonts.length - 1,
    );
  });
}

// Called on every (re)build start; `build --watch` on Rolldown transforms every module again.
// Dev keeps its state: there buildStart runs once
export function resetBuildState(ctx: PluginContext, environment = ""): void {
  ctx.cache?.resetUsage(environment);
  if (ctx.isServe) return;
  ctx.progress.clear();
  ctx.rawSources.clear();
  ctx.sourceReads.clear();
  ctx.minifications.clear();
  ctx.emittedFonts.clear();
  ctx.inlinedFonts.clear();
  ctx.preloadSources.clear();
  ctx.probeAssets.clear();
  ctx.glyphsFindMap.clear();
  ctx.graph.reset();
  ctx.autoGlyphSets.clear();
  Object.assign(ctx.stats, { minified: 0, cached: 0, saved: 0 });
  ctx.isMinifyPhaseLogged = false;
}
