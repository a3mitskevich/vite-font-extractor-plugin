import { describe, it, expect } from "vitest";
import { extname } from "node:path";
import type { OutputAsset } from "./utils";
import {
  buildFixture,
  type CssMinify,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixtures,
  type FixturesNames,
  fontsLength,
  getReadableFontAssets,
  openFont,
  type OutputItem,
  rendersLigature,
} from "./utils";

describe("Common", () => {
  const runCommonTest = (fixturesNames: FixturesNames) => {
    describe(`Common test`, () => {
      fixturesNames.forEach((fixtureName) => {
        const fixture = fixtures[fixtureName];
        Array.from(["lightningcss", "esbuild"] as CssMinify[]).forEach((cssMinify) => {
          describe(`Build test for "${fixtureName}" fixture with "${cssMinify}" css minificator`, () => {
            // Both tests inspect the same build
            let result: ReturnType<typeof buildFixture> | undefined;
            const build = () =>
              (result ??= buildFixture({
                cssMinify,
                fixture: fixture.path,
                targets: fixture.fonts.map((font) => font.name),
              }));

            it("should return a bundle with minified fonts keeping the target ligatures", async () => {
              const { output } = await build();
              const items = output as OutputItem[];
              const fontAssets = output.filter(
                (asset): asset is OutputAsset =>
                  asset.type === "asset" && asset.fileName.includes("font-"),
              );
              const cssAssets = output.filter(
                (asset): asset is OutputAsset =>
                  asset.type === "asset" && asset.fileName.endsWith(".css"),
              );

              expect(fontAssets).toHaveLength(fixture.fonts.flatMap((font) => font.urls).length);

              fontAssets.forEach((asset) => {
                const ext = extname(asset.name ?? asset.fileName).slice(
                  1,
                ) as keyof typeof fontsLength;
                expect(asset.source.length).toBeLessThan(fontsLength[ext]);
              });
              cssAssets.forEach((asset) => {
                const content = asset.source.toString();
                if (content.includes("@font-face")) {
                  fontAssets.forEach((asset) => {
                    expect(content).toContain(asset.fileName);
                  });
                }
              });

              const readable = getReadableFontAssets(items);
              expect(readable.length).toBeGreaterThan(0);
              readable.forEach((asset) => {
                const font = openFont(asset.source);
                expect(rendersLigature(font, "close"), asset.fileName).toBe(true);
                expect(rendersLigature(font, "play_arrow"), asset.fileName).toBe(true);
                expect(rendersLigature(font, "star"), asset.fileName).toBe(false);
              });
            });

            it("should reference only emitted fonts and leave no orphans", async () => {
              const { output } = await build();
              const items = output as OutputItem[];
              expect(findBrokenFontReferences(items)).toEqual([]);
              expect(findOrphanFontAssets(items)).toEqual([]);
            });
          });
        });
      });
    });
  };

  runCommonTest(["plain", "plain-html", "mixins", "import-css", "import-js"]);
});
