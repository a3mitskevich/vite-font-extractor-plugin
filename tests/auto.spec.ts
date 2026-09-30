import { describe, it, expect } from "vitest";
import { extname } from "node:path";
import type { OutputAsset } from "rollup";
import {
  buildByVersion,
  type BuildOptions,
  type ContainerVersion,
  type CssMinify,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixtures,
  fontsLength,
  getReadableFontAssets,
  hasGlyph,
  openFont,
  type OutputItem,
  viteBuild,
} from "./utils";

// `content` in the auto fixture holds U+E5CD ("close" in Material Icons)
const CLOSE_CODE_POINT = 0xe5cd;
const STAR_CODE_POINT = 0xe838;

describe("Auto", () => {
  const runCommonTest = (version: ContainerVersion) => {
    describe(`Common test for vite@${version}`, () => {
      const fixture = fixtures.auto;
      Array.from(["lightningcss", "esbuild"] as CssMinify[]).forEach((cssMinify) => {
        describe(`Build test for "auto" fixture with "${cssMinify}" css minificator`, () => {
          const build = async (options?: BuildOptions) =>
            buildByVersion(version, {
              ...options,
              cssMinify,
              pluginOptions: {
                type: "auto",
              },
              fixture: fixture.path,
              targets: fixture.fonts.map((font) => font.name),
            });

          it("should return a bundle with fonts minified to the glyphs used in CSS", async () => {
            const { output, messages } = await build();
            const items = output as OutputItem[];
            const fontAssets = output.filter(
              (asset): asset is OutputAsset =>
                asset.type === "asset" && asset.fileName.includes("font-"),
            );

            expect(fontAssets).toHaveLength(fixture.fonts.flatMap((font) => font.urls).length);

            fontAssets.forEach((asset) => {
              const ext = extname(asset.name ?? asset.fileName).slice(
                1,
              ) as keyof typeof fontsLength;
              expect(asset.source.length).toBeLessThan(fontsLength[ext]);
            });
            expect(findBrokenFontReferences(items)).toEqual([]);
            expect(findOrphanFontAssets(items)).toEqual([]);
            expect(messages.filter((m) => m.type === "error")).toEqual([]);

            const readable = getReadableFontAssets(items);
            expect(readable.length).toBeGreaterThan(0);
            readable.forEach((asset) => {
              const font = openFont(asset.source);
              expect(hasGlyph(font, CLOSE_CODE_POINT), asset.fileName).toBe(true);
              expect(hasGlyph(font, STAR_CODE_POINT), asset.fileName).toBe(false);
            });
          });
        });
      });
    });
  };

  const runAllTests = () => {
    Object.keys(viteBuild).forEach((version) => {
      runCommonTest(version);
    });
  };

  runAllTests();
});
