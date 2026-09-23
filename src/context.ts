import type Cache from "./cache";
import type {
  FontReference,
  ImportResolvers,
  InternalLogger,
  OptionsWithCacheSid,
  PluginOption,
  ServeFontStubResponse,
  IconTarget,
  Target,
  TargetOptionsMap,
} from "./types";

export interface PluginContext {
  readonly mode: PluginOption["type"];
  readonly pluginOption: PluginOption;
  readonly targets: Target[];
  readonly optionsMap: TargetOptionsMap;
  readonly autoProxyOption: OptionsWithCacheSid<IconTarget>;

  cache: Cache | null;
  importResolvers: ImportResolvers | null;
  logger: InternalLogger | null;

  isServe: boolean;
  // Resolved `config.base`; dev urls carry it and must be stripped before resolving files
  base: string;
  readonly glyphsFindMap: Map<string, string[]>;
  // Keyed by `${referenceId}:${subsetKey}:${fontName}`
  readonly transformMap: Map<string, FontReference>;
  // Build: asset reference ids of each transformed module. `vite build --watch` re-transforms
  // only changed modules, so entries of transformMap are replaced per module
  readonly moduleReferences: Map<string, ReadonlySet<string>>;
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

function createAutoTarget(glyphsFindMap: Map<string, string[]>): IconTarget {
  return {
    get fontName(): string {
      throw new Error("Illegal access. Font name must be provided from another place");
    },
    get raws(): string[] {
      return Array.from(glyphsFindMap.values()).flat();
    },
    withWhitespace: true,
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
    base: "/",
    glyphsFindMap,
    transformMap: new Map(),
    moduleReferences: new Map(),
    fontServeProxy: new Map(),
    progress: new Map(),
    loadedAutoFontMap: new Map(),
  };
}

// Called on every (re)build start. Dev keeps its state: there buildStart runs once
export function resetBuildState(ctx: PluginContext): void {
  ctx.cache?.resetUsage();
  if (!ctx.isServe) {
    ctx.progress.clear();
  }
}

const isHeldByOtherModule = (ctx: PluginContext, referenceId: string, id: string): boolean =>
  [...ctx.moduleReferences].some(([moduleId, refs]) => moduleId !== id && refs.has(referenceId));

function deleteReferences(ctx: PluginContext, referenceIds: ReadonlySet<string>): void {
  for (const [key, reference] of ctx.transformMap) {
    if (referenceIds.has(reference.referenceId)) {
      ctx.transformMap.delete(key);
    }
  }
}

// Before a module is (re)transformed: drops the entries it registered last time.
// References shared with other modules stay — those modules may be served from cache
export function replaceModuleReferences(
  ctx: PluginContext,
  id: string,
  referenceIds: ReadonlySet<string>,
): void {
  const previous = ctx.moduleReferences.get(id) ?? new Set<string>();
  ctx.moduleReferences.set(id, referenceIds);
  const owned = [...previous, ...referenceIds].filter((ref) => !isHeldByOtherModule(ctx, ref, id));
  deleteReferences(ctx, new Set(owned));
}

// After all modules are transformed: forgets modules that left the build
export function pruneBuildState(ctx: PluginContext, moduleIds: Iterable<string>): void {
  const live = new Set(moduleIds);
  const released = new Set<string>();
  for (const [id, refs] of ctx.moduleReferences) {
    if (live.has(id)) continue;
    ctx.moduleReferences.delete(id);
    refs.forEach((ref) => released.add(ref));
  }
  const unheld = [...released].filter((ref) => !isHeldByOtherModule(ctx, ref, ""));
  deleteReferences(ctx, new Set(unheld));
  for (const id of ctx.glyphsFindMap.keys()) {
    if (!live.has(id)) {
      ctx.glyphsFindMap.delete(id);
    }
  }
}
