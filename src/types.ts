import type { Formats, IconOption, SubsetOption } from "fontext";

export interface ServeFontStubResponse {
  extension: Formats;
  content: Buffer;
  id: string;
}
import type { InlineConfig, Logger, LogType, ResolveFn, Plugin } from "vite";

export type Target = Omit<IconOption, "formats"> | Omit<SubsetOption, "formats">;
export type IconTarget = Omit<IconOption, "formats">;

export interface PluginCommonConfig {
  cache?: string | boolean;
  apply?: Plugin["apply"];
  logLevel?: InlineConfig["logLevel"];
  // Build: path of a JSON report of the fonts, relative to the output directory or absolute
  report?: string;
  // Traces why each font is (not) minified; also on with `DEBUG=vite-font-extractor`
  debug?: boolean;
}

export interface PluginManualOption {
  type: "manual";
  targets: Target[] | Target;
  ignore?: string[];
}

export interface PluginAutoOption {
  type: "auto";
  targets?: Target[] | Target;
  ignore?: string[];
}

export type PluginOption = PluginCommonConfig & (PluginAutoOption | PluginManualOption);

export interface SubsetOptions {
  characters?: string;
  unicodeRanges?: string[];
}

export interface ImportResolvers {
  font: ResolveFn;
}

export interface OptionsWithCacheSid<T extends Target = Target> {
  sid: string;
  target: T;
  auto: boolean;
}

export interface FontMeta {
  name: string;
  options: OptionsWithCacheSid;
}

export interface FontFaceMeta extends FontMeta {
  face: string;
  aliases: string[];
}

export interface MinifyFontOptions {
  source?: Buffer | string;
  url: string;
  importer?: string;
  extension: Formats;
}

export interface MinifyStats {
  minified: number;
  cached: number;
  saved: number;
}

export type DebugMessage = string | (() => string);

export interface InternalLogger extends Pick<Logger, LogType> {
  fix(): void;
  readonly isDebug: boolean;
  // Printed as info only when debug is on; `id` is the module or file the line is about
  debug(message: DebugMessage, id?: string): void;
  banner(): void;
  config(mode: string, details: string): void;
  phase(icon: string, name: string): void;
  found(type: string, name: string, detail?: string): void;
  minified(fontName: string, ext: string, original: number, result: number, isLast?: boolean): void;
  cached(fontName: string): void;
  // Number of `cached()` calls so far — the build summary counts cache hits from it
  cachedCount(): number;
  skipped(fontName: string, reason: string): void;
  summary(stats: MinifyStats): void;
}

export type StyledFn = (message: string) => string;
export type StyleMessage<K extends string> = { [key in K | string]: StyledFn };
type ReadonlyMap<K, V> = Pick<Map<K, V>, "get" | "has">;

export type TargetOptionsMap = ReadonlyMap<Target["fontName"], OptionsWithCacheSid>;
