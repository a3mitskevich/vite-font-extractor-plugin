import { describe, it, expect } from "vitest";
import type { OutputAsset, OutputChunk } from "rollup";
import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import * as fontkit from "fontkit";
import type { PluginOption } from "../src";
import {
  type ContainerVersion,
  type FakeLogger,
  fixturesDir,
  fontsLength,
  generateId,
  type InlineConfig,
  type LoggerMessage,
  outDir,
  plugin,
  viteBuild,
} from "./utils";

type OutputItem = OutputAsset | OutputChunk;
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

const createFakeLogger = (): FakeLogger => {
  const messages: LoggerMessage[] = [];
  return new Proxy(
    {},
    {
      get(_, key: string) {
        if (key === "messages") return messages;
        if (key === "clearScreen" || key === "hasErrorLogged") return () => false;
        return (message: string) => messages.push({ type: key as LoggerMessage["type"], message });
      },
    },
  ) as FakeLogger;
};

interface ConfigBuildOptions {
  fixture: string;
  pluginOptions?: PluginOption;
  build?: BuildConfig;
}

const buildWithConfig = async (
  version: ContainerVersion,
  { fixture, pluginOptions = MANUAL_OPTIONS, build = {} }: ConfigBuildOptions,
): Promise<{ output: OutputItem[]; messages: LoggerMessage[] }> => {
  const customLogger = createFakeLogger();
  const config: InlineConfig = {
    root: join(fixturesDir, fixture),
    configFile: false,
    logLevel: "silent",
    customLogger,
    plugins: [await plugin(pluginOptions)],
    build: {
      outDir: join(outDir, `${generateId()}-V${version}`),
      write: false,
      emptyOutDir: false,
      ...build,
    },
  };
  const result = await viteBuild[version](config);
  const [first] = Array.isArray(result) ? result : [result];
  return { output: (first as { output: OutputItem[] }).output, messages: customLogger.messages };
};

const textOf = (item: OutputItem): string | null => {
  if (item.type === "chunk") return item.code;
  return typeof item.source === "string" ? item.source : null;
};

const getFontAssets = (output: OutputItem[]): OutputAsset[] =>
  output.filter(
    (item): item is OutputAsset => item.type === "asset" && FONT_EXT_RE.test(item.fileName),
  );

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

const openFont = (asset: OutputAsset): fontkit.Font =>
  fontkit.create(Buffer.from(asset.source)) as fontkit.Font;

// A ligature is rendered when the text collapses into one existing glyph
const rendersLigature = (font: fontkit.Font, text: string): boolean => {
  const glyphs = font.layout(text).glyphs;
  return glyphs.length === 1 && glyphs[0].id !== 0;
};

// fontkit fails on layout() of a missing ligature in WOFF — check code points there
const expectOnlyCloseGlyph = (asset: OutputAsset): void => {
  const font = openFont(asset);
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

describe.sequential("Build configuration", () => {
  const runBuildConfigTests = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      it("should rewrite the single CSS file of build.cssCodeSplit: false", async () => {
        const { output, messages } = await buildWithConfig(version, {
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
        const { output, messages } = await buildWithConfig(version, { fixture: "preload-html" });

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
            const { output, messages } = await buildWithConfig(version, {
              fixture: "asset-names",
              build: { rollupOptions: { output: { assetFileNames: pattern } } },
            });

            const fonts = getFontAssets(output);
            expect(fonts).toHaveLength(3);
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

      it("should warn that a font inlined by build.assetsInlineLimit is not minified", async () => {
        const { output, messages } = await buildWithConfig(version, {
          fixture: "inline-font",
          build: { assetsInlineLimit: 100_000_000 },
        });

        expect(getFontAssets(output)).toEqual([]);
        const warnings = problems(messages);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].type).toBe("warn");
        expect(warnings[0].message).toContain('"Font Name"');
        expect(warnings[0].message).toMatch(/inlined/);
        expect(warnings[0].message).not.toMatch(/Asset not found/);
      });

      it("should warn that a font inlined by library mode is not minified", async () => {
        const root = join(fixturesDir, "inline-font");
        const { messages } = await buildWithConfig(version, {
          fixture: "inline-font",
          build: { lib: { entry: join(root, "lib.js"), formats: ["es"], fileName: "lib" } },
        });

        const warnings = problems(messages);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toContain('"Font Name"');
        expect(warnings[0].message).toMatch(/inlined/);
      });

      it("should log the reason when a font fails to minify", async () => {
        const { output, messages } = await buildWithConfig(version, {
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
          const first = await buildWithConfig(version, { fixture: "plain", pluginOptions });
          const second = await buildWithConfig(version, { fixture: "plain", pluginOptions });

          expect(summaryOf(first.messages)).not.toContain("cached");
          expect(summaryOf(second.messages)).toContain("1 cached");
        } finally {
          rmSync(cacheDir, { recursive: true, force: true });
        }
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runBuildConfigTests(version);
  });
});
