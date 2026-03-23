import type { Format } from "fontext";
import type Cache from "./cache";
import type {
  ImportResolvers,
  InternalLogger,
  OptionsWithCacheSid,
  PluginOption,
  Target,
  TargetOptionsMap,
} from "./types";

export interface ServeFontStubResponse {
  extension: Format;
  content: Buffer;
  id: string;
}

export interface PluginContext {
  readonly mode: PluginOption["type"];
  readonly pluginOption: PluginOption;
  readonly targets: Target[];
  readonly optionsMap: TargetOptionsMap;
  readonly autoProxyOption: OptionsWithCacheSid;

  cache: Cache | null;
  importResolvers: ImportResolvers;
  logger: InternalLogger;

  isServe: boolean;
  readonly glyphsFindMap: Map<string, string[]>;
  readonly transformMap: Map<string, { fontName: string; options: OptionsWithCacheSid }>;
  readonly fontServeProxy: Map<string, () => Promise<ServeFontStubResponse | null>>;
  readonly progress: Map<string, string>;
  readonly loadedAutoFontMap: Map<string, boolean>;
}

function createAutoTarget(glyphsFindMap: Map<string, string[]>): Target {
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
    cache: null as any,
    importResolvers: null as any,
    logger: null as any,
    isServe: false,
    glyphsFindMap,
    transformMap: new Map(),
    fontServeProxy: new Map(),
    progress: new Map(),
    loadedAutoFontMap: new Map(),
  };
}
