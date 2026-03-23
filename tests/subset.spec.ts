import { describe, it, expect } from "vitest";
import type { OutputAsset } from "rollup";
import {
  buildByVersion,
  type ContainerVersion,
  fixtures,
  textFontsLength,
  viteBuild,
} from "./utils";

function getFontAssets(output: OutputAsset[]): OutputAsset[] {
  return output.filter((a): a is OutputAsset => a.type === "asset" && a.fileName.includes("font"));
}

function assertFontsMinified(fontAssets: OutputAsset[]): void {
  expect(fontAssets.length).toBeGreaterThan(0);
  for (const asset of fontAssets) {
    const ext = asset.fileName.split(".").pop() as keyof typeof textFontsLength;
    const originalSize = textFontsLength[ext];
    if (originalSize) {
      const minifiedSize = Buffer.from(asset.source).length;
      expect(minifiedSize).toBeLessThan(originalSize);
      expect(minifiedSize).toBeGreaterThan(0);
    }
  }
}

describe.sequential("Font subsetting", () => {
  const runSubsetTest = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      describe("?subset=<chars>", () => {
        it("should produce fonts smaller than original", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-chars"].path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Text Font" }],
            },
          });

          assertFontsMinified(getFontAssets(output as OutputAsset[]));
        });
      });

      describe("?subset=<unicode-range>", () => {
        it("should produce fonts smaller than original", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-range"].path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Text Font" }],
            },
          });

          assertFontsMinified(getFontAssets(output as OutputAsset[]));
        });
      });

      describe("?subset=<chars>,<range> combined", () => {
        it("should produce fonts smaller than original", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-combined"].path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Text Font" }],
            },
          });

          assertFontsMinified(getFontAssets(output as OutputAsset[]));
        });
      });

      describe("Target.characters config", () => {
        it("should produce fonts smaller than original via config", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-chars"].path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Text Font", characters: "ABCabc", engine: "subset" as const }],
            },
          });

          assertFontsMinified(getFontAssets(output as OutputAsset[]));
        });
      });

      describe("multiple different ?subset= for same file (CSS)", () => {
        it("should produce different minified assets for different subsets", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-multi-css"].path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Text Latin" }, { fontName: "Text Digits" }],
            },
          });

          const fontAssets = getFontAssets(output as OutputAsset[]);
          // Should have at least 2 font assets (one per subset)
          expect(fontAssets.length).toBeGreaterThanOrEqual(2);

          // Assets should have different sizes (different character sets)
          const sizes = fontAssets.map((a) => Buffer.from(a.source).length);
          const uniqueSizes = new Set(sizes);
          expect(uniqueSizes.size).toBeGreaterThanOrEqual(2);
        });
      });

      describe("same ?subset= for same file (CSS dedup)", () => {
        it("should produce one minified asset for identical subsets", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-same-css"].path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Font A" }, { fontName: "Font B" }],
            },
          });

          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBeGreaterThanOrEqual(1);

          // All font assets should have the same size (same subset applied)
          const sizes = fontAssets.map((a) => Buffer.from(a.source).length);
          const uniqueSizes = new Set(sizes);
          expect(uniqueSizes.size).toBe(1);
        });
      });

      describe("same ?subset= for same file (JS dedup)", () => {
        it("should deduplicate identical subsets to one asset", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-same-js"].path,
            pluginOptions: { type: "manual", targets: [] },
          });

          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBe(1);

          // JS chunk should reference the same URL for both imports
          const jsChunk = output.find((a) => a.type === "chunk" && a.fileName.includes("index"));
          expect(jsChunk).toBeTruthy();
          if (jsChunk && "code" in jsChunk) {
            expect(jsChunk.code).not.toContain("?subset=");
          }
        });
      });

      describe("multiple different ?subset= for same file (JS)", () => {
        it("should strip ?subset= and produce font assets", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-multi-js"].path,
            pluginOptions: { type: "manual", targets: [] },
          });

          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBeGreaterThanOrEqual(1);

          // JS chunk should have clean URLs
          const jsChunk = output.find((a) => a.type === "chunk" && a.fileName.includes("index"));
          expect(jsChunk).toBeTruthy();
          if (jsChunk && "code" in jsChunk) {
            expect(jsChunk.code).not.toContain("?subset=");
          }
        });
      });

      describe("JS import with ?subset=", () => {
        it("should strip ?subset= from JS output URL", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures["subset-js"].path,
            pluginOptions: {
              type: "manual",
              targets: [],
            },
          });

          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBeGreaterThan(0);

          const jsChunk = output.find((a) => a.type === "chunk" && a.fileName.includes("index"));
          expect(jsChunk).toBeTruthy();
          if (jsChunk && "code" in jsChunk) {
            expect(jsChunk.code).not.toContain("?subset=");
          }
        });
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runSubsetTest(version);
  });
});
