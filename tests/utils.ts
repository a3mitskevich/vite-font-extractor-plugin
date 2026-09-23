import {
  build as buildV5,
  type InlineConfig as InlineConfigV5,
  version as versionV5,
  type Plugin as PluginV5,
  type Logger as LoggerV5,
} from "vite-5";
import {
  build as buildV6,
  type InlineConfig as InlineConfigV6,
  version as versionV6,
  type Plugin as PluginV6,
  type Logger as LoggerV6,
} from "vite-6";
import {
  build as buildV7,
  type InlineConfig as InlineConfigV7,
  version as versionV7,
  type Plugin as PluginV7,
  type Logger as LoggerV7,
} from "vite-7";
import {
  build as buildV8,
  type InlineConfig as InlineConfigV8,
  version as versionV8,
  type Plugin as PluginV8,
  type Logger as LoggerV8,
} from "vite-8";
import { mergeConfig, type ResolvedConfig } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, rmSync } from "node:fs";
import * as fontkit from "fontkit";
import type { FontExtractorPlugin, Target, PluginOption } from "../src";
import type { OutputAsset, RollupOutput } from "rollup";

export type InlineConfig = InlineConfigV5 & InlineConfigV6 & InlineConfigV7 & InlineConfigV8;
export type Plugin = PluginV5 & PluginV6 & PluginV7 & PluginV8;
export type ContainerVersion =
  | typeof versionV5
  | typeof versionV6
  | typeof versionV7
  | typeof versionV8;
export type Logger = LoggerV5 & LoggerV6 & LoggerV7 & LoggerV8;
export interface LoggerMessage {
  type: "error" | "warn" | "info";
  message: string;
}
export type FakeLogger = Logger & { messages: LoggerMessage[] };
export type CssMinify = ResolvedConfig["build"]["cssMinify"];

export function createCachedImport<T>(imp: () => Promise<T>): () => T | Promise<T> {
  let cached: T | Promise<T>;
  return async () => {
    if (!cached) {
      cached = imp().then((module) => {
        cached = module;
        return module;
      });
    }
    return cached;
  };
}

export interface BuildOptions {
  pluginOptions?: PluginOption;
  // Exact plugin call arguments, e.g. `[]` for the zero-config call; overrides `pluginOptions`
  pluginArgs?: Parameters<FontExtractorPlugin>;
  // Plugin factory to call instead of the TEST_TARGET one (e.g. the CommonJS build)
  pluginFactory?: FontExtractorPlugin;
  customLogger?: FakeLogger;
  // Build with Vite's own console logger instead of a custom one; `messages` stays empty
  useConsoleLogger?: boolean;
  cache?: false;
  fixture?: string;
  targets?: string[];
  cssMinify?: CssMinify;
  manifest?: boolean;
  ssr?: string;
  // Extra Vite config deep-merged over the defaults below
  config?: InlineConfig;
}

export interface Font {
  name: string;
  urls: string[];
}

export interface Fixture {
  path: string;
  fonts: Font[];
  description?: string;
}

export const dir = dirname(fileURLToPath(import.meta.url));
export const fixturesDir = join(dir, "fixtures");

export const getIconFontSize = (ext: string): number =>
  readFileSync(join(fixturesDir, "fonts", `icon-font.${ext}`)).length;

export const getTextFontSize = (ext: string): number =>
  readFileSync(join(fixturesDir, "fonts", `text-font.${ext}`)).length;

export const fontsLength = {
  eot: getIconFontSize("eot"),
  ttf: getIconFontSize("ttf"),
  woff: getIconFontSize("woff"),
  woff2: getIconFontSize("woff2"),
};

export const textFontsLength = {
  woff: getTextFontSize("woff"),
  woff2: getTextFontSize("woff2"),
};

export const outDir = join(dir, "dist");

export const DEFAULT_FONT: Font = {
  name: "Font Name",
  urls: [
    "../fonts/icon-font.eot",
    "../fonts/icon-font.ttf",
    "../fonts/icon-font.woff",
    "../fonts/icon-font.woff2",
  ],
};

export const createFixture = (
  name: string,
  options: Omit<Fixture, "path"> = {
    fonts: [DEFAULT_FONT],
  },
): Fixture => ({
  path: join(fixturesDir, name),
  ...options,
});

export const DEFAULT_GOOGLE_FONT = {
  fonts: [
    { name: "Index", urls: [] },
    { name: "Css font", urls: [] },
  ],
};

export const fixtures = {
  "import-css": createFixture("import-css"),
  "import-js": createFixture("import-js"),
  mixins: createFixture("mixins", {
    fonts: [{ ...DEFAULT_FONT, urls: ["../fonts/icon-font.woff"] }],
  }),
  plain: createFixture("plain"),
  "plain-html": createFixture("plain-html"),
  "google-font": createFixture("google-font", DEFAULT_GOOGLE_FONT),
  "google-font-warn": createFixture("google-font-warn", DEFAULT_GOOGLE_FONT),
  "font-family-resource-is-url": createFixture("font-family-resource-is-url", {
    fonts: [{ ...DEFAULT_FONT, urls: [] }],
  }),
  auto: createFixture("auto"),
  "google-font-multi": createFixture("google-font-multi", {
    fonts: [
      { name: "Font A", urls: [] },
      { name: "Font B", urls: [] },
      { name: "Font C", urls: [] },
      { name: "Font D", urls: [] },
    ],
  }),
  "multi-weight": createFixture("multi-weight"),
  "font-display": createFixture("font-display"),
  "absolute-path": createFixture("absolute-path"),
  "dynamic-import": createFixture("dynamic-import", { fonts: [] }),
  "url-pattern": createFixture("url-pattern", { fonts: [] }),
  "subset-multi-css": createFixture("subset-multi-css", { fonts: [] }),
  "subset-multi-js": createFixture("subset-multi-js", { fonts: [] }),
  "subset-same-css": createFixture("subset-same-css", { fonts: [] }),
  "subset-same-js": createFixture("subset-same-js", { fonts: [] }),
  "subset-js": createFixture("subset-js", { fonts: [{ name: "Font", urls: [] }] }),
  "subset-chars": createFixture("subset-chars"),
  "subset-range": createFixture("subset-range"),
  "subset-combined": createFixture("subset-combined"),
  "auto-one-icon": createFixture("auto-one-icon"),
  "auto-two-icons": createFixture("auto-two-icons"),
  "multi-source": createFixture("multi-source"),
  "duplicate-url": createFixture("duplicate-url"),
  "shared-file-families": createFixture("shared-file-families"),
  "subset-target-chars": createFixture("subset-target-chars"),
  configs: createFixture("configs"),
  "configs-css-modules": createFixture("configs-css-modules"),
  "configs-css-inline": createFixture("configs-css-inline"),
  "configs-lazy-css": createFixture("configs-lazy-css"),
  "configs-two-entries": createFixture("configs-two-entries"),
  "log-levels": createFixture("log-levels"),
} as const;

export type FixturesNames = Array<keyof typeof fixtures>;

export const importTargets = {
  local: createCachedImport(async () => import("../src")),
  dist: createCachedImport(async () => import("../dist")),
};

// Returns Plugin compatible with all Vite versions — cross-version types are incompatible in strict mode
export const plugin = async (...args: Parameters<FontExtractorPlugin>): Promise<Plugin> => {
  const testTarget = process.env.TEST_TARGET as keyof typeof importTargets;
  const { default: index } = await importTargets[testTarget ?? "local"]();
  return index.apply(null, args) as Plugin;
};

export const generateId = (): string => Math.random().toString(32).slice(2, 10);

export const viteBuild = {
  [versionV5]: buildV5,
  [versionV6]: buildV6,
  [versionV7]: buildV7,
  [versionV8]: buildV8,
};

const createLogger = (): FakeLogger => {
  const messages: LoggerMessage[] = [];
  return new Proxy(
    {},
    {
      get(_: any, key: any): any {
        if (key === "messages") {
          return messages;
        }
        if (["clearScreen", "hasErrorLogged"].includes(key as string)) {
          return () => false;
        }
        return (message: string) => {
          messages.push({ type: key, message });
        };
      },
    },
  ) as FakeLogger;
};

export const buildByVersion = async (
  version: ContainerVersion,
  options: BuildOptions = {
    fixture: fixtures.plain.path,
  },
) => {
  const id = generateId() + `-V${version}`;
  const out = join(outDir, id);

  const targets =
    options.targets?.map<Target>((fontName) => ({
      fontName,
      ligatures: ["close", "play_arrow"],
    })) ?? [];

  const pluginOptions = options.pluginOptions ?? {
    type: "manual",
    targets,
    cache: options.cache == null ? out : options.cache,
  };

  const pluginArgs = options.pluginArgs ?? [pluginOptions];
  const FontExtract = options.pluginFactory
    ? (options.pluginFactory(...pluginArgs) as Plugin)
    : await plugin(...pluginArgs);
  const customLogger = options.useConsoleLogger
    ? undefined
    : (options.customLogger ?? createLogger());
  const inlineConfig: InlineConfig = {
    root: options.fixture,
    configFile: false,
    // No affect custom logger
    logLevel: "silent",
    customLogger,
    plugins: [FontExtract],
    build: {
      outDir: out,
      emptyOutDir: true,
      sourcemap: false,
      cssMinify: options.cssMinify,
      manifest: options.manifest,
      ssr: options.ssr,
    },
    environments: {
      client: {
        build: {
          commonjsOptions: {
            include: ["node_modules"],
          },
          dynamicImportVarsOptions: {
            exclude: ["node_modules"],
          },
        },
      },
    },
  };
  const config = options.config ? mergeConfig(inlineConfig, options.config) : inlineConfig;
  const result = (await viteBuild[version](config)) as RollupOutput | RollupOutput[];
  // Several `output` options produce one bundle each
  const bundles = Array.isArray(result) ? result : [result];

  rmSync(out, { recursive: true, force: true });

  return {
    output: bundles[0].output,
    outputs: bundles.map((bundle) => bundle.output),
    out,
    messages: customLogger?.messages ?? [],
  };
};

export interface FontReference {
  from: string;
  // Output file name the reference resolves to, or the referenced path when nothing matches
  path: string;
}

export type OutputItem = RollupOutput["output"][number];

export const FONT_FILE_RE = /\.(?:woff2?|ttf|eot|otf|svg)$/;

// Runs of url/path characters (`\ ` is an escaped space in CSS). Matched greedily — a lazy
// pattern ending in the extension is quadratic on long base64/minified runs.
const PATH_TOKEN_RE = /(?:[\w\-.~@+%/:]|\\ )+/g;

const SOURCE_MAP_RE = /\.map$/;
const MANIFEST_RE = /manifest\.json$/;
// Unminified Rolldown output names source modules in `//#region <path>` comments
const REGION_COMMENT_RE = /^\s*\/\/#(?:end)?region\b.*$/gm;

interface ManifestChunk {
  file?: string;
  css?: string[];
  assets?: string[];
}

const getOutputText = (item: OutputItem): string | null => {
  if (item.type === "chunk") return item.code;
  return typeof item.source === "string" ? item.source : null;
};

// Manifest keys and `src` are source paths — only emitted files count as references
const getManifestText = (source: string): string =>
  Object.values(JSON.parse(source) as Record<string, ManifestChunk>)
    .flatMap((chunk) => [chunk.file ?? "", ...(chunk.css ?? []), ...(chunk.assets ?? [])])
    .map((file) => `"${file}"`)
    .join("\n");

const getReferenceText = (item: OutputItem): string | null => {
  // Source maps list original sources, not emitted files
  if (SOURCE_MAP_RE.test(item.fileName)) return null;
  const text = getOutputText(item);
  if (text == null) return null;
  if (MANIFEST_RE.test(item.fileName)) return getManifestText(text);
  return item.type === "chunk" ? text.replace(REGION_COMMENT_RE, "") : text;
};

const decodePath = (token: string): string =>
  token
    .replaceAll("\\ ", " ")
    .replaceAll("%20", " ")
    .replace(/^\.{0,2}\/+/, "");

const baseNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Font file references in text outputs, independent of `base` (absolute, relative, CDN url)
 * and `assetFileNames`: a reference is matched to an output file by its base name.
 * Plain (unescaped) spaces inside names are not supported.
 */
export const collectFontReferences = (
  output: OutputItem[],
  files: OutputItem[] = output,
): FontReference[] => {
  const fileByBaseName = new Map(files.map((item) => [baseNameOf(item.fileName), item.fileName]));
  return output.flatMap((item) => {
    const text = getReferenceText(item);
    if (!text) return [];
    return Array.from(text.matchAll(PATH_TOKEN_RE), ([token]) => decodePath(token))
      .filter((path) => FONT_FILE_RE.test(path))
      .map((path) => ({ from: item.fileName, path: fileByBaseName.get(baseNameOf(path)) ?? path }));
  });
};

// References to font files that are not present in the build output (would 404 at runtime)
export const findBrokenFontReferences = (output: OutputItem[]): FontReference[] => {
  const fileNames = new Set(output.map((item) => item.fileName));
  return collectFontReferences(output).filter((ref) => !fileNames.has(ref.path));
};

const FONT_FACE_BLOCK_RE = /@font-face\s*\{[^}]*\}/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}]+)/;

// Output font files each @font-face family points at, across all CSS assets
export const getFontFilesByFamily = (output: OutputItem[]): Map<string, string[]> => {
  const css = output
    .filter((item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(".css"))
    .map((item) => String(item.source))
    .join("\n");
  const byFamily = new Map<string, string[]>();
  for (const [block] of css.matchAll(FONT_FACE_BLOCK_RE)) {
    const family = FONT_FAMILY_RE.exec(block)?.[1].replace(/["']/g, "").trim() ?? "";
    const blockItem = { type: "asset", fileName: "", source: block } as OutputAsset;
    const paths = collectFontReferences([blockItem], output).map((ref) => ref.path);
    byFamily.set(family, [...(byFamily.get(family) ?? []), ...paths]);
  }
  return byFamily;
};

export const getOutputAsset = (output: OutputItem[], fileName: string): OutputAsset => {
  const asset = output.find(
    (item): item is OutputAsset => item.type === "asset" && item.fileName === fileName,
  );
  if (!asset) throw new Error(`Asset "${fileName}" not found in build output`);
  return asset;
};

export const getFontAssets = (output: OutputItem[]): OutputAsset[] =>
  output.filter(
    (item): item is OutputAsset => item.type === "asset" && FONT_FILE_RE.test(item.fileName),
  );

// Emitted font files that nothing in the output points at
export const findOrphanFontAssets = (output: OutputItem[]): string[] => {
  const referenced = new Set(collectFontReferences(output).map((ref) => ref.path));
  return getFontAssets(output)
    .map((asset) => asset.fileName)
    .filter((fileName) => !referenced.has(fileName));
};

// EOT and SVG fonts are not readable by fontkit
const FONTKIT_READABLE_RE = /\.(?:woff2?|ttf|otf)$/;

export const getReadableFontAssets = (output: OutputItem[]): OutputAsset[] =>
  getFontAssets(output).filter((asset) => FONTKIT_READABLE_RE.test(asset.fileName));

export const openFont = (source: string | Uint8Array): fontkit.Font =>
  fontkit.create(Buffer.from(source)) as fontkit.Font;

// fontkit reads glyph data lazily; a missing ligature in a fontext WOFF points outside the table
const WOFF_MISSING_GLYPH_ERROR = "Offset is outside the bounds";

// A ligature is rendered when the text collapses into one existing glyph
export const rendersLigature = (font: fontkit.Font, text: string): boolean => {
  try {
    const { glyphs } = font.layout(text);
    return glyphs.length === 1 && glyphs[0].id !== 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes(WOFF_MISSING_GLYPH_ERROR)) return false;
    throw error;
  }
};

export const hasGlyph = (font: fontkit.Font, codePoint: number): boolean =>
  font.hasGlyphForCodePoint(codePoint);

export const hasGlyphsFor = (font: fontkit.Font, text: string): boolean =>
  Array.from(text).every((char) => hasGlyph(font, char.codePointAt(0)!));

export const hasAnyGlyphFor = (font: fontkit.Font, text: string): boolean =>
  Array.from(text).some((char) => hasGlyph(font, char.codePointAt(0)!));
