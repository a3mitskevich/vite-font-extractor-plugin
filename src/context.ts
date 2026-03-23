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
  readonly transformMap: Map<string, string>;
  readonly fontServeProxy: Map<string, () => Promise<ServeFontStubResponse | null>>;
  readonly progress: Map<string, string>;
  readonly loadedAutoFontMap: Map<string, boolean>;
}

export function createPluginContext(pluginOption: PluginOption): PluginContext {
  const mode: PluginOption["type"] = pluginOption.type ?? "manual";

  const glyphsFindMap = new Map<string, string[]>();

  const autoTarget = new Proxy<Target>(
    {
      fontName: "ERROR: Illegal access. Font name must be provided from another place instead it",
      raws: [],
      withWhitespace: true,
      ligatures: [],
    },
    {
      get(target: Target, key: keyof Target): any {
        if (key === "fontName") {
          throw Error(target[key]);
        }
        if (key === "raws") {
          return Array.from(glyphsFindMap.values()).flat();
        }
        return target[key];
      },
    },
  );

  const autoProxyOption = new Proxy<OptionsWithCacheSid>(
    {
      sid: "[calculating...]",
      target: autoTarget,
      auto: true,
    },
    {
      get(target: OptionsWithCacheSid, key: keyof OptionsWithCacheSid): any {
        if (key === "sid") {
          return JSON.stringify(autoTarget.raws);
        }
        return target[key];
      },
    },
  );

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

  const optionsMap = {
    get: (key: string) => {
      const option = casualOptionsMap.get(key);
      return mode === "auto" ? (option ?? autoProxyOption) : option;
    },
    has: (key: string) => mode === "auto" || casualOptionsMap.has(key),
  } satisfies TargetOptionsMap;

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
