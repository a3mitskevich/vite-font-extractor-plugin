import type Cache from "./cache";
import type {
  ImportResolvers,
  InternalLogger,
  OptionsWithCacheSid,
  PluginOption,
  ServeFontStubResponse,
  Target,
  TargetOptionsMap,
} from "./types";

export interface PluginContext {
  readonly mode: PluginOption["type"];
  readonly pluginOption: PluginOption;
  readonly targets: Target[];
  readonly optionsMap: TargetOptionsMap;
  readonly autoProxyOption: OptionsWithCacheSid;

  cache: Cache | null;
  importResolvers: ImportResolvers | null;
  logger: InternalLogger | null;

  isServe: boolean;
  readonly glyphsFindMap: Map<string, string[]>;
  readonly transformMap: Map<string, { fontName: string; options: OptionsWithCacheSid }>;
  readonly fontServeProxy: Map<string, () => Promise<ServeFontStubResponse | null>>;
  readonly progress: Map<string, string>;
  readonly loadedAutoFontMap: Map<string, boolean>;
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

function createAutoTarget(glyphsFindMap: Map<string, string[]>): Target {
  let cachedRaws: string[] | null = null;
  let cachedSize = 0;

  return {
    get fontName(): string {
      throw new Error("Illegal access. Font name must be provided from another place");
    },
    get raws(): string[] {
      // Invalidate cache when glyphsFindMap changes
      if (!cachedRaws || cachedSize !== glyphsFindMap.size) {
        cachedSize = glyphsFindMap.size;
        cachedRaws = Array.from(glyphsFindMap.values()).flat();
      }
      return cachedRaws;
    },
    withWhitespace: true,
    ligatures: [],
  };
}

function createAutoOption(autoTarget: Target): OptionsWithCacheSid {
  return {
    get sid(): string {
      return JSON.stringify(autoTarget.raws);
    },
    target: autoTarget,
    auto: true,
  };
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

  return {
    mode,
    pluginOption,
    targets,
    optionsMap,
    autoProxyOption,
    cache: null,
    importResolvers: null,
    logger: null,
    isServe: false,
    glyphsFindMap,
    transformMap: new Map(),
    fontServeProxy: new Map(),
    progress: new Map(),
    loadedAutoFontMap: new Map(),
  };
}
