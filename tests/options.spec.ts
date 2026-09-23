import { describe, it, expect } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildByVersion,
  type ContainerVersion,
  findBrokenFontReferences,
  fixtures,
  fontsLength,
  getFontAssets,
  getReadableFontAssets,
  hasGlyph,
  openFont,
  type OutputItem,
  viteBuild,
  outDir,
} from "./utils";

describe.sequential("Plugin options", () => {
  const runOptionsTest = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      describe("ignore option", () => {
        it("should not process ignored fonts", async () => {
          const { output } = await buildByVersion(version, {
            fixture: fixtures.plain.path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Font Name", ligatures: ["close"] }],
              ignore: ["Font Name"],
            },
          });

          // Every format of the ignored font is emitted at its original size
          const fontAssets = getFontAssets(output as OutputItem[]);
          expect(fontAssets.map((asset) => asset.fileName.split(".").pop()).sort()).toEqual([
            "eot",
            "ttf",
            "woff",
            "woff2",
          ]);
          fontAssets.forEach((asset) => {
            const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
            expect(Buffer.from(asset.source).length, asset.fileName).toBe(fontsLength[ext]);
          });
        });
      });

      describe("cache option", () => {
        it("should create cache in custom path", async () => {
          const customCachePath = join(outDir, `cache-test-${version}`);

          await buildByVersion(version, {
            fixture: fixtures.plain.path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Font Name", ligatures: ["close"] }],
              cache: customCachePath,
            },
          });

          const cacheDir = join(customCachePath, ".font-extractor-cache");
          expect(existsSync(cacheDir)).toBeTruthy();

          // Cleanup
          rmSync(customCachePath, { recursive: true, force: true });
        });

        it("should work without cache", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures.plain.path,
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Font Name", ligatures: ["close"] }],
              cache: false,
            },
          });

          const hasError = messages.some((m) => m.type === "error");
          expect(hasError).toBeFalsy();

          const fontAssets = getFontAssets(output as OutputItem[]);
          expect(fontAssets.length).toBeGreaterThan(0);
          fontAssets.forEach((asset) => {
            const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
            expect(Buffer.from(asset.source).length, asset.fileName).toBeLessThan(fontsLength[ext]);
          });
        });
      });

      describe("auto mode defaults", () => {
        it("should work with zero-config (no options)", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures.auto.path,
            pluginArgs: [],
          });
          const items = output as OutputItem[];

          expect(messages.filter((m) => m.type === "error")).toEqual([]);
          expect(messages.some((m) => m.message.includes("auto mode"))).toBe(true);
          expect(findBrokenFontReferences(items)).toEqual([]);

          // The glyph from `content` in the fixture CSS is detected and kept
          const readable = getReadableFontAssets(items);
          expect(readable.length).toBeGreaterThan(0);
          readable.forEach((asset) => {
            const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
            expect(Buffer.from(asset.source).length).toBeLessThan(fontsLength[ext]);
            const font = openFont(asset.source);
            expect(hasGlyph(font, 0xe5cd), asset.fileName).toBe(true);
            expect(hasGlyph(font, 0xe838), asset.fileName).toBe(false);
          });
        });
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runOptionsTest(version);
  });
});
