import type { Format, MinifyOption } from "fontext";

export interface ServeFontStubResponse {
  extension: Format;
  content: Buffer;
  id: string;
}
import type { InlineConfig, Logger, LogType, ResolveFn, Plugin } from "vite";

export type Target = Omit<MinifyOption, "formats">;

export interface PluginCommonConfig {
  cache?: string | boolean;
  apply?: Plugin["apply"];
  logLevel?: InlineConfig["logLevel"];
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
  common: ResolveFn;
  font: ResolveFn;
}

export interface OptionsWithCacheSid {
  sid: string;
  target: Target;
  auto: boolean;
}

export interface FontMeta {
  name: string;
  options: OptionsWithCacheSid;
}

export interface GoogleFontMeta extends FontMeta {
  url: URL;
}

export interface FontFaceMeta extends FontMeta {
  face: string;
  aliases: string[];
}

export interface MinifyFontOptions {
  source?: Buffer | string;
  url: string;
  importer?: string;
  extension: Format;
}

export interface MinifyStats {
  minified: number;
  cached: number;
  saved: number;
}

export interface InternalLogger extends Pick<Logger, LogType> {
  fix(): void;
  banner(): void;
  config(mode: string, details: string): void;
  phase(icon: string, name: string): void;
  found(type: string, name: string, detail?: string): void;
  minified(fontName: string, ext: string, original: number, result: number, isLast?: boolean): void;
  cached(fontName: string): void;
  skipped(fontName: string, reason: string): void;
  summary(stats: MinifyStats): void;
}

export type StyledFn = (message: string) => string;
export type StyleMessage<K extends string> = { [key in K | string]: StyledFn };
type ReadonlyMap<K, V> = Pick<Map<K, V>, "get" | "has">;

export type TargetOptionsMap = ReadonlyMap<Target["fontName"], OptionsWithCacheSid>;
