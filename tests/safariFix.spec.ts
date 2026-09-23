import { describe, it, expect } from "vitest";
import { extname } from "node:path";
import type { OutputAsset } from "rollup";
import type * as fontkit from "fontkit";
import {
  buildByVersion,
  type ContainerVersion,
  type CssMinify,
  fixtures,
  fontsLength,
  getReadableFontAssets,
  openFont,
  type OutputItem,
  rendersLigature,
  viteBuild,
} from "./utils";

interface VerticalMetrics {
  ascent: number;
  descent: number;
  lineGap: number;
}

// fontext `safariFix` copies the OS/2 typo metrics into hhea, so Safari and other browsers
// compute the same line box. For the icon fixture only hhea.lineGap (0 vs 90) tells them apart.
const getHheaMetrics = (font: fontkit.Font): VerticalMetrics => ({
  ascent: font.hhea.ascent,
  descent: font.hhea.descent,
  lineGap: font.hhea.lineGap,
});

const getTypoMetrics = (font: fontkit.Font): VerticalMetrics => ({
  ascent: font["OS/2"].typoAscender,
  descent: font["OS/2"].typoDescender,
  lineGap: font["OS/2"].typoLineGap,
});

describe("safariFix option", () => {
  const runSafariFixTest = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      (["lightningcss", "esbuild"] as CssMinify[]).forEach((cssMinify) => {
        describe(`with "${cssMinify}" css minifier`, () => {
          const build = (safariFix: boolean) =>
            buildByVersion(version, {
              fixture: fixtures.plain.path,
              cssMinify,
              pluginOptions: {
                type: "manual",
                targets: [{ fontName: "Font Name", ligatures: ["close", "play_arrow"], safariFix }],
              },
            });

          it("should minify fonts with safariFix enabled", async () => {
            const { output, messages } = await build(true);

            const hasError = messages.some((m) => m.type === "error");
            expect(hasError).toBeFalsy();

            const fontAssets = output.filter(
              (a): a is OutputAsset => a.type === "asset" && a.fileName.includes("font-"),
            );
            const cssAssets = output.filter(
              (a): a is OutputAsset => a.type === "asset" && a.fileName.endsWith(".css"),
            );

            expect(fontAssets.length).toBeGreaterThan(0);

            // Fonts should be minified (smaller than original)
            fontAssets.forEach((asset) => {
              const ext = extname(asset.name ?? asset.fileName).slice(
                1,
              ) as keyof typeof fontsLength;
              expect(asset.source.length).toBeLessThan(fontsLength[ext]);
              expect(asset.source.length).toBeGreaterThan(0);
            });

            // CSS should reference minified font filenames
            cssAssets.forEach((cssAsset) => {
              const content = cssAsset.source.toString();
              if (content.includes("@font-face")) {
                fontAssets.forEach((fontAsset) => {
                  expect(content).toContain(fontAsset.fileName);
                });
              }
            });

            const readable = getReadableFontAssets(output as OutputItem[]);
            expect(readable.length).toBeGreaterThan(0);
            readable.forEach((asset) => {
              const font = openFont(asset.source);
              expect(getHheaMetrics(font), asset.fileName).toEqual(getTypoMetrics(font));
              expect(rendersLigature(font, "close"), asset.fileName).toBe(true);
            });
          });

          it("should minify fonts with safariFix disabled", async () => {
            const { output, messages } = await build(false);

            const hasError = messages.some((m) => m.type === "error");
            expect(hasError).toBeFalsy();

            const fontAssets = output.filter(
              (a): a is OutputAsset => a.type === "asset" && a.fileName.includes("font-"),
            );
            expect(fontAssets.length).toBeGreaterThan(0);

            fontAssets.forEach((asset) => {
              const ext = extname(asset.name ?? asset.fileName).slice(
                1,
              ) as keyof typeof fontsLength;
              expect(asset.source.length).toBeLessThan(fontsLength[ext]);
            });

            // hhea keeps the generator's own metrics: the line gap differs from OS/2
            const readable = getReadableFontAssets(output as OutputItem[]);
            expect(readable.length).toBeGreaterThan(0);
            readable.forEach((asset) => {
              const font = openFont(asset.source);
              expect(getHheaMetrics(font), asset.fileName).not.toEqual(getTypoMetrics(font));
              expect(rendersLigature(font, "close"), asset.fileName).toBe(true);
            });
          });
        });
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runSafariFixTest(version);
  });
});
