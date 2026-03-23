import { describe, it, expect } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { OutputAsset } from "rollup";
import {
  buildByVersion,
  type ContainerVersion,
  fixtures,
  fontsLength,
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

          // Font should remain unminified (original size)
          const fontAssets = output.filter(
            (a): a is OutputAsset => a.type === "asset" && a.fileName.includes("font"),
          );

          fontAssets.forEach((asset) => {
            const size = Buffer.from(asset.source).length;
            const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
            if (fontsLength[ext]) {
              // Original size = not minified
              expect(size).toBe(fontsLength[ext]);
            }
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

          const fontAssets = output.filter(
            (a): a is OutputAsset => a.type === "asset" && a.fileName.includes("font"),
          );
          expect(fontAssets.length).toBeGreaterThan(0);
        });
      });

      describe("auto mode defaults", () => {
        it("should work with zero-config (no options)", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures.auto.path,
            pluginOptions: { type: "auto" },
          });

          const hasError = messages.some((m) => m.type === "error");
          expect(hasError).toBeFalsy();
          expect(output.length).toBeGreaterThan(0);
        });
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runOptionsTest(version);
  });
});
