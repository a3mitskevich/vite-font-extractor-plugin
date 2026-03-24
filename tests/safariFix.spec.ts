import { describe, it, expect } from "vitest";
import { extname } from "node:path";
import type { OutputAsset } from "rollup";
import {
  buildByVersion,
  type ContainerVersion,
  type CssMinify,
  fixtures,
  fontsLength,
  viteBuild,
} from "./utils";

describe("safariFix option", () => {
  const runSafariFixTest = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      (["lightningcss", "esbuild"] as CssMinify[]).forEach((cssMinify) => {
        describe(`with "${cssMinify}" css minifier`, () => {
          it("should minify fonts with safariFix enabled", async () => {
            const { output, messages } = await buildByVersion(version, {
              fixture: fixtures.plain.path,
              cssMinify,
              pluginOptions: {
                type: "manual",
                targets: [
                  { fontName: "Font Name", ligatures: ["close", "play_arrow"], safariFix: true },
                ],
              },
            });

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
          });

          it("should minify fonts with safariFix disabled", async () => {
            const { output, messages } = await buildByVersion(version, {
              fixture: fixtures.plain.path,
              cssMinify,
              pluginOptions: {
                type: "manual",
                targets: [
                  { fontName: "Font Name", ligatures: ["close", "play_arrow"], safariFix: false },
                ],
              },
            });

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
          });
        });
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runSafariFixTest(version);
  });
});
