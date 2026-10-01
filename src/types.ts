import type { Formats, IconOption, SubsetOption } from "fontext";

export interface ServeFontStubResponse {
  extension: Formats;
  content: Buffer;
  id: string;
}
import type { InlineConfig, Logger, LogType, ResolveFn, Plugin } from "vite";

// An @font-face the plugin sees: in a stylesheet, or a family of a Google Fonts url
export interface FontFaceInfo {
  // `font-family`, unquoted
  family: string;
  // `url()`s of the face; for a Google Fonts family the stylesheet url
  urls: string[];
  // Module id of the stylesheet, "" for HTML
  id: string;
}

// A family name, a pattern tested against the family, or a predicate of the face
export type FaceMatcher = string | RegExp | ((face: FontFaceInfo) => boolean);

// Module ids as Vite's `createFilter` takes them: globs relative to `root`, regular expressions
export type ModuleFilterPattern = string | RegExp | Array<string | RegExp>;

export type Target = (Omit<IconOption, "formats"> | Omit<SubsetOption, "formats">) & {
  // Faces the target applies to; without it, the faces whose `font-family` is `fontName`
  match?: FaceMatcher;
};
export type IconTarget = Omit<IconOption, "formats">;

export interface PluginCommonConfig {
  cache?: string | boolean;
  apply?: Plugin["apply"];
  logLevel?: InlineConfig["logLevel"];
  // Build: path of a JSON report of the fonts, relative to the output directory or absolute
  report?: string;
  // Traces why each font is (not) minified; also on with `DEBUG=vite-font-extractor`
  debug?: boolean;
  // Modules whose fonts are minified: stylesheets, and JS modules with `?subset=` fonts
  include?: ModuleFilterPattern;
  exclude?: ModuleFilterPattern;
  // A build fails instead of keeping the original file of a target font
  strict?: boolean;
  /**
   * The last word on every face: a target to minify it with, `null` to leave it alone, `undefined`
   * to keep the decision of `targets`/`ignore` (`resolved`). Must be pure: output names follow it.
   */
  resolveTarget?: (face: FontFaceInfo, resolved: Target | null) => Target | null | undefined;
}

export interface PluginManualOption {
  type: "manual";
  targets: Target[] | Target;
  ignore?: FaceMatcher[];
}

export interface PluginAutoOption {
  type: "auto";
  targets?: Target[] | Target;
  ignore?: FaceMatcher[];
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
  skipped(fontName: string, reason: string): void;
  summary(stats: MinifyStats): void;
}

export type StyledFn = (message: string) => string;
export type StyleMessage<K extends string> = { [key in K | string]: StyledFn };
