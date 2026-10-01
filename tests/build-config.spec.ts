import { describe, it, expect } from "vitest";
import type { OutputAsset } from "./utils";
import { readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { build as viteBuild } from "vite";
import type { PluginOption } from "../src";
import {
  createFakeLogger,
  getFontAssets,
  openFont,
  type OutputItem,
  rendersLigature,
  fixturesDir,
  fontsLength,
  generateId,
  type InlineConfig,
  type LoggerMessage,
  outDir,
  plugin,
} from "./utils";

type BuildConfig = NonNullable<InlineConfig["build"]>;

interface PreRenderedAssetInfo {
  name?: string;
  names?: string[];
}

const FONT_EXT_RE = /\.(?:woff2?|ttf|eot|otf)$/;
const TOKEN_SEPARATOR_RE = /[\s"'`()\\,=<>/]+/;
const MANIFEST_RE = /manifest\.json$/;
const CLOSE_CODE_POINT = 0xe5cd;
const STAR_CODE_POINT = 0xe838;

const ICON_TARGET = { fontName: "Font Name", ligatures: ["close"] };
const MANUAL_OPTIONS: PluginOption = { type: "manual", targets: [ICON_TARGET] };

interface ConfigBuildOptions {
  fixture: string;
  pluginOptions?: PluginOption;
  build?: BuildConfig;
}

const buildWithConfig = async ({
  fixture,
  pluginOptions = MANUAL_OPTIONS,
  build = {},
}: ConfigBuildOptions): Promise<{ output: OutputItem[]; messages: LoggerMessage[] }> => {
  const customLogger = createFakeLogger();
  const config: InlineConfig = {
    root: join(fixturesDir, fixture),
    configFile: false,
    logLevel: "silent",
    customLogger,
    plugins: [await plugin(pluginOptions)],
    build: {
      outDir: join(outDir, generateId()),
      write: false,
      emptyOutDir: false,
      ...build,
    },
  };
  const result = await viteBuild(config);
  const [first] = Array.isArray(result) ? result : [result];
  return {
    output: (first as unknown as { output: OutputItem[] }).output,
    messages: customLogger.messages,
  };
};

const textOf = (item: OutputItem): string | null => {
  if (item.type === "chunk") return item.code;
  return typeof item.source === "string" ? item.source : null;
};

// Font file names referenced from CSS/HTML/JS, whatever `assetFileNames` produced
const collectReferencedFontNames = (output: OutputItem[]): Array<{ from: string; name: string }> =>
  output
    .filter((item) => !item.fileName.endsWith(".map") && !MANIFEST_RE.test(item.fileName))
    .flatMap((item) =>
      (textOf(item) ?? "")
        .split(TOKEN_SEPARATOR_RE)
        .map((token) => token.split(/[?#]/)[0])
        .filter((name) => FONT_EXT_RE.test(name))
        .map((name) => ({ from: item.fileName, name })),
    );

interface ManifestEntry {
  file?: string;
  assets?: string[];
}

const collectManifestFiles = (output: OutputItem[]): string[] =>
  output
    .filter((item) => MANIFEST_RE.test(item.fileName))
    .flatMap((item) =>
      Object.values(JSON.parse(textOf(item) ?? "{}") as Record<string, ManifestEntry>).flatMap(
        (entry) => [entry.file ?? "", ...(entry.assets ?? [])],
      ),
    )
    .filter((file) => FONT_EXT_RE.test(file));

const findBrokenReferences = (output: OutputItem[]): string[] => {
  const fileNames = new Set(output.map((item) => item.fileName));
  const baseNames = new Set(output.map((item) => basename(item.fileName)));
  const brokenText = collectReferencedFontNames(output)
    .filter((ref) => !baseNames.has(ref.name))
    .map((ref) => `${ref.from} -> ${ref.name}`);
  const brokenManifest = collectManifestFiles(output)
    .filter((file) => !fileNames.has(file))
    .map((file) => `manifest -> ${file}`);
  return [...brokenText, ...brokenManifest];
};

const findOrphanFonts = (output: OutputItem[]): string[] => {
  const referenced = new Set(collectReferencedFontNames(output).map((ref) => ref.name));
  return getFontAssets(output)
    .map((asset) => asset.fileName)
    .filter((fileName) => !referenced.has(basename(fileName)));
};

const extensionOf = (fileName: string): keyof typeof fontsLength =>
  fileName.split(".").pop() as keyof typeof fontsLength;

// fontkit fails on layout() of a missing ligature in WOFF — check code points there
const expectOnlyCloseGlyph = (asset: OutputAsset): void => {
  const font = openFont(asset.source);
  if (asset.fileName.endsWith(".woff")) {
    expect(font.hasGlyphForCodePoint(CLOSE_CODE_POINT)).toBe(true);
    expect(font.hasGlyphForCodePoint(STAR_CODE_POINT)).toBe(false);
    return;
  }
  expect(rendersLigature(font, "close")).toBe(true);
  expect(rendersLigature(font, "star")).toBe(false);
};

const problems = (messages: LoggerMessage[]): LoggerMessage[] =>
  messages.filter((message) => message.type === "warn" || message.type === "error");

// Invariants of every minified build: nothing broken, nothing orphaned, fonts smaller and usable
const expectHealthyFontOutput = (output: OutputItem[], messages: LoggerMessage[]): void => {
  const fonts = getFontAssets(output);
  expect(fonts.length).toBeGreaterThan(0);
  expect(findBrokenReferences(output)).toEqual([]);
  expect(findOrphanFonts(output)).toEqual([]);
  for (const asset of fonts) {
    expect(Buffer.from(asset.source).length).toBeLessThan(fontsLength[extensionOf(asset.fileName)]);
    expectOnlyCloseGlyph(asset);
  }
  expect(problems(messages)).toEqual([]);
};

const DATA_URL_RE = /data:font\/(woff2?|ttf);base64,([A-Za-z0-9+/=]+)/g;

// Fonts inlined as data: URLs anywhere in the output
const inlinedFonts = (output: OutputItem[]): Array<{ format: string; bytes: Buffer }> =>
  output.flatMap((item) =>
    Array.from((textOf(item) ?? "").matchAll(DATA_URL_RE), (match) => ({
      format: match[1],
      bytes: Buffer.from(match[2], "base64"),
    })),
  );

const textFontSize = (format: string): number =>
  readFileSync(join(fixturesDir, "fonts", `text-font.${format}`)).length;

const expectInlinedMinifiedFonts = (output: OutputItem[], format: string): void => {
  const fonts = inlinedFonts(output).filter((font) => font.format === format);
  expect(fonts.length).toBeGreaterThan(0);
  for (const { bytes } of fonts) {
    expect(bytes.length).toBeLessThan(fontsLength[format as keyof typeof fontsLength]);
    const font = openFont(bytes);
    expect(rendersLigature(font, "close")).toBe(true);
    expect(rendersLigature(font, "star")).toBe(false);
  }
};

const fontAssetFileNames = (info: PreRenderedAssetInfo): string =>
  FONT_EXT_RE.test(info.names?.[0] ?? info.name ?? "")
    ? "f/[hash][extname]"
    : "assets/[name]-[hash][extname]";

const ASSET_FILE_NAME_CASES = [
  { title: "[name][extname]", pattern: "[name][extname]", expected: /^icon-font\d*\.\w+$/ },
  { title: "[hash][extname]", pattern: "[hash][extname]", expected: /^[\w-]{8}\.\w+$/ },
  {
    title: "fonts/[name].[hash][extname]",
    pattern: "fonts/[name].[hash][extname]",
    expected: /^fonts\/icon-font\.[\w-]{8}\.\w+$/,
  },
  { title: "a function", pattern: fontAssetFileNames, expected: /^f\/[\w-]{8}\.\w+$/ },
];

describe("Build configuration", () => {
  it("should rewrite the single CSS file of build.cssCodeSplit: false", async () => {
    const { output, messages } = await buildWithConfig({
      fixture: "css-code-split",
      build: { cssCodeSplit: false, manifest: true },
    });

    const css = output.filter((item) => item.fileName.endsWith(".css"));
    expect(css).toHaveLength(1);
    expect(getFontAssets(output)).toHaveLength(3);
    expect(collectManifestFiles(output).length).toBeGreaterThan(0);
    expectHealthyFontOutput(output, messages);
  });

  it("should rewrite a font preloaded from HTML", async () => {
    const { output, messages } = await buildWithConfig({ fixture: "preload-html" });

    const html = output.find((item) => item.fileName === "index.html");
    const preloaded = collectReferencedFontNames([html!]);
    expect(preloaded).toHaveLength(1);
    expect(preloaded[0].name).toMatch(/\.woff2$/);
    expectHealthyFontOutput(output, messages);
  });

  describe.each(ASSET_FILE_NAME_CASES)(
    "build.rollupOptions.output.assetFileNames: $title",
    ({ pattern, expected }) => {
      it("should name minified fonts by the pattern", async () => {
        const { output, messages } = await buildWithConfig({
          fixture: "asset-names",
          build: { rollupOptions: { output: { assetFileNames: pattern } } },
        });

        // Three formats of the @font-face and the JS ?subset= import
        const fonts = getFontAssets(output);
        expect(fonts).toHaveLength(4);
        for (const asset of fonts) {
          expect(asset.fileName).toMatch(expected);
        }
        expect(collectReferencedFontNames(output).some((ref) => ref.from.endsWith(".js"))).toBe(
          true,
        );
        expectHealthyFontOutput(output, messages);
      });
    },
  );

  it("should keep the original name of a minified @font-face with assetFileNames without [hash]", async () => {
    const { output, messages } = await buildWithConfig({
      fixture: "plain",
      build: { rollupOptions: { output: { assetFileNames: "assets/[name][extname]" } } },
    });

    expect(
      getFontAssets(output)
        .map((asset) => asset.fileName)
        .sort(),
    ).toEqual([
      "assets/icon-font.eot",
      "assets/icon-font.ttf",
      "assets/icon-font.woff",
      "assets/icon-font.woff2",
    ]);
    expect(findBrokenReferences(output)).toEqual([]);
    expect(findOrphanFonts(output)).toEqual([]);
    for (const asset of getFontAssets(output)) {
      expect(Buffer.from(asset.source).length).toBeLessThan(
        fontsLength[extensionOf(asset.fileName)],
      );
    }
    expect(problems(messages)).toEqual([]);
  });

  // Known limitation: Vite emits the original of a face from a Sass mixin before the plugin
  // sees the compiled CSS, so the minified font gets the next free name
  it("should number the minified font of a Sass mixin face with assetFileNames without [hash]", async () => {
    const { output, messages } = await buildWithConfig({
      fixture: "mixins",
      build: { rollupOptions: { output: { assetFileNames: "assets/[name][extname]" } } },
    });

    const fonts = getFontAssets(output);
    expect(fonts.map((asset) => asset.fileName)).toEqual(["assets/icon-font2.woff"]);
    expectHealthyFontOutput(output, messages);
  });

  it("should inline the minified font where Vite inlines the original (assetsInlineLimit)", async () => {
    const { output, messages } = await buildWithConfig({
      fixture: "inline-font",
      build: { assetsInlineLimit: 100_000_000 },
    });

    expect(getFontAssets(output)).toEqual([]);
    expectInlinedMinifiedFonts(output, "woff2");
    expect(problems(messages)).toEqual([]);
  });

  it("should inline the minified font in library mode", async () => {
    const root = join(fixturesDir, "inline-font");
    const { output, messages } = await buildWithConfig({
      fixture: "inline-font",
      build: { lib: { entry: join(root, "lib.js"), formats: ["es"], fileName: "lib" } },
    });

    expect(getFontAssets(output)).toEqual([]);
    expectInlinedMinifiedFonts(output, "woff2");
    expect(problems(messages)).toEqual([]);
  });

  it("should inline the minified font of an inlined ?subset= face", async () => {
    const { output, messages } = await buildWithConfig({
      fixture: "subset-chars",
      pluginOptions: { type: "manual", targets: [] },
      build: { assetsInlineLimit: 100_000_000 },
    });

    expect(getFontAssets(output)).toEqual([]);
    const fonts = inlinedFonts(output);
    expect(fonts.map((font) => font.format).sort()).toEqual(["woff", "woff2"]);
    fonts.forEach(({ format, bytes }) => expect(bytes.length).toBeLessThan(textFontSize(format)));
    expect(problems(messages)).toEqual([]);
  });

  it("should inline the minified font of an inlined ?subset= import", async () => {
    const { output, messages } = await buildWithConfig({
      fixture: "subset-js",
      pluginOptions: { type: "manual", targets: [] },
      build: { assetsInlineLimit: 100_000_000 },
    });

    expect(getFontAssets(output)).toEqual([]);
    const fonts = inlinedFonts(output);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].bytes.length).toBeLessThan(textFontSize("woff2"));
    expect(problems(messages)).toEqual([]);
  });

  it("should log the reason when a font fails to minify", async () => {
    const { output, messages } = await buildWithConfig({
      fixture: "plain",
      pluginOptions: {
        type: "manual",
        targets: [{ fontName: "Font Name", characters: "abc" }],
      },
    });

    const errors = messages.filter((message) => message.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Failed to minify "Font Name" — keeping original: \S+/);
    expect(findBrokenReferences(output)).toEqual([]);
  });

  it("should count fonts restored from cache in the summary", async () => {
    const cacheDir = join(outDir, `cache-${generateId()}`);
    const pluginOptions: PluginOption = { ...MANUAL_OPTIONS, cache: cacheDir };
    const summaryOf = (messages: LoggerMessage[]): string | undefined =>
      messages.find((message) => message.message.includes("Done"))?.message;
    try {
      const first = await buildWithConfig({ fixture: "plain", pluginOptions });
      const second = await buildWithConfig({ fixture: "plain", pluginOptions });

      expect(summaryOf(first.messages)).not.toContain("cached");
      expect(summaryOf(second.messages)).toContain("1 cached");
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

const REPORT_FILE = "font-report.json";
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

interface ReportJson {
  version: string;
  mode: string;
  environment: string;
  fonts: Array<{
    fontName: string;
    source: string;
    format: string;
    output: string;
    originalSize: number;
    minifiedSize: number;
    cached: boolean;
    glyphs: Record<string, unknown>;
  }>;
  skipped: Array<{ fontName: string; source?: string; reason: string }>;
  ignored?: Array<{ fontName: string; id: string; reason: string }>;
  totals: { originalSize: number; minifiedSize: number; saved: number };
}

const readReport = (output: OutputItem[]): ReportJson => {
  const asset = output.find((item) => item.fileName === REPORT_FILE);
  expect(asset?.type).toBe("asset");
  return JSON.parse(textOf(asset!) ?? "") as ReportJson;
};

describe("Build report", () => {
  it("should list every emitted font with its sizes, cached on a second build", async () => {
    const cacheDir = join(outDir, `cache-${generateId()}`);
    const pluginOptions: PluginOption = { ...MANUAL_OPTIONS, cache: cacheDir, report: REPORT_FILE };
    try {
      const first = await buildWithConfig({
        fixture: "plain",
        pluginOptions,
        build: { manifest: true },
      });
      const report = readReport(first.output);
      expect(report).toMatchObject({
        version: PACKAGE_VERSION,
        mode: "manual",
        environment: "client",
      });
      expect(report.skipped).toEqual([]);

      const fonts = getFontAssets(first.output);
      expect(report.fonts.map((font) => font.format)).toEqual(["eot", "ttf", "woff", "woff2"]);
      for (const font of report.fonts) {
        const asset = fonts.find((item) => item.fileName === font.output);
        expect(asset, font.output).toBeDefined();
        expect(font).toMatchObject({
          fontName: "Font Name",
          source: `../fonts/icon-font.${font.format}`,
          originalSize: fontsLength[font.format as keyof typeof fontsLength],
          minifiedSize: Buffer.from(asset!.source).length,
          cached: false,
          glyphs: { ligatures: ["close"] },
        });
      }
      const originalSize = report.fonts.reduce((sum, font) => sum + font.originalSize, 0);
      const minifiedSize = report.fonts.reduce((sum, font) => sum + font.minifiedSize, 0);
      expect(report.totals).toEqual({
        originalSize,
        minifiedSize,
        saved: originalSize - minifiedSize,
      });

      // Not a font: the manifest does not list it and the cleanup keeps it
      const manifest = first.output.find((item) => MANIFEST_RE.test(item.fileName));
      expect(textOf(manifest!)).not.toContain(REPORT_FILE);
      // The report names the source files, it references no output
      const withoutReport = first.output.filter((item) => item.fileName !== REPORT_FILE);
      expect(findBrokenReferences(withoutReport)).toEqual([]);
      expect(findOrphanFonts(withoutReport)).toEqual([]);
      expect(problems(first.messages)).toEqual([]);

      const second = await buildWithConfig({ fixture: "plain", pluginOptions });
      const cached = readReport(second.output);
      expect(cached.fonts.map((font) => font.cached)).toEqual([true, true, true, true]);
      const uncached = (fonts: ReportJson["fonts"]): ReportJson["fonts"] =>
        fonts.map((font) => ({ ...font, cached: false }));
      expect(uncached(cached.fonts)).toEqual(report.fonts);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("should list the glyphs found in auto mode", async () => {
    const { output } = await buildWithConfig({
      fixture: "auto-one-icon",
      pluginOptions: { type: "auto", report: REPORT_FILE },
    });

    const report = readReport(output);
    expect(report.mode).toBe("auto");
    expect(report.fonts.length).toBeGreaterThan(0);
    for (const font of report.fonts) {
      expect(font.glyphs).toEqual({ raws: [String.fromCodePoint(CLOSE_CODE_POINT)] });
    }
  });

  it("should list a font that failed to minify as skipped", async () => {
    const { output } = await buildWithConfig({
      fixture: "plain",
      pluginOptions: {
        type: "manual",
        report: REPORT_FILE,
        targets: [{ fontName: "Font Name", characters: "abc" }],
      },
    });

    const report = readReport(output);
    expect(report.fonts).toEqual([]);
    expect(report.skipped.map((skip) => skip.source)).toEqual(
      ["eot", "ttf", "woff", "woff2"].map((format) => `../fonts/icon-font.${format}`),
    );
    for (const skip of report.skipped) {
      expect(skip.fontName).toBe("Font Name");
      expect(skip.reason).toMatch(/^minification failed: \S+/);
    }
    expect(report.totals).toEqual({ originalSize: 0, minifiedSize: 0, saved: 0 });
  });

  it("should list faces without options or with remote urls as skipped, left-out faces as ignored", async () => {
    const pluginOptions: PluginOption = {
      type: "manual",
      report: REPORT_FILE,
      targets: [ICON_TARGET, { fontName: "Remote Icons", ligatures: ["close"] }],
      ignore: ["Ignored Icons"],
      exclude: /\/vendor\//,
      resolveTarget: (face) => (face.family === "Code Skipped" ? null : undefined),
    };
    const builds = await Promise.all(
      [1, 2].map(() => buildWithConfig({ fixture: "report-faces", pluginOptions })),
    );
    const [report, again] = builds.map(({ output }) => readReport(output));

    expect(report.fonts.map((font) => [font.fontName, font.source])).toEqual([
      ["Font Name", "../fonts/icon-font.woff2"],
    ]);
    expect(report.skipped).toEqual([
      {
        fontName: "Remote Icons",
        reason: "external url sources: https://example.com/remote-icons.woff2",
      },
      { fontName: "Untargeted", reason: "no minify options" },
    ]);
    expect(report.ignored).toEqual([
      { fontName: "Code Skipped", id: "src/app.css", reason: "resolveTarget" },
      { fontName: "Ignored Icons", id: "src/app.css", reason: "ignore" },
      { fontName: "Vendor Icons", id: "vendor/vendor.css", reason: "include/exclude" },
    ]);
    expect(again).toEqual(report);
  });

  it("should leave ignored out of a report without ignored faces", async () => {
    const { output } = await buildWithConfig({
      fixture: "plain",
      pluginOptions: { ...MANUAL_OPTIONS, report: REPORT_FILE },
    });
    expect(readReport(output)).not.toHaveProperty("ignored");
  });

  it("should write a report outside the output directory to disk", async () => {
    const file = join(outDir, `report-${generateId()}`, "fonts.json");
    try {
      const { output } = await buildWithConfig({
        fixture: "plain",
        pluginOptions: { ...MANUAL_OPTIONS, report: file },
      });
      expect(output.some((item) => item.fileName.endsWith(".json"))).toBe(false);
      const report = JSON.parse(readFileSync(file, "utf8")) as ReportJson;
      expect(report.fonts).toHaveLength(4);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  it("should reject a report option that is not a path", async () => {
    await expect(plugin({ ...MANUAL_OPTIONS, report: " " })).rejects.toThrow(
      "`report` must be a file path",
    );
  });

  it("should not write a report without the option", async () => {
    const { output } = await buildWithConfig({ fixture: "plain" });
    expect(output.some((item) => item.fileName.endsWith(".json"))).toBe(false);
  });
});
