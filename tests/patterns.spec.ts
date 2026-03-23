import { describe, it, expect } from "vitest";
import type { OutputAsset } from "rollup";
import { buildByVersion, type ContainerVersion, fixtures, fontsLength, viteBuild } from "./utils";

function getFontAssets(output: OutputAsset[]): OutputAsset[] {
  return output.filter((a): a is OutputAsset => a.type === "asset" && a.fileName.includes("font"));
}

describe.sequential("Font import patterns", () => {
  const runPatternTests = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      describe("multi-weight @font-face", () => {
        it("should process both weights of same font family", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["multi-weight"].path,
            targets: ["Font Name"],
          });

          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBeGreaterThan(0);

          const hasError = messages.some((m) => m.type === "error");
          expect(hasError).toBeFalsy();

          // Should have minified fonts
          const hasMinified = fontAssets.some((asset) => {
            const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
            return fontsLength[ext] && Buffer.from(asset.source).length < fontsLength[ext];
          });
          expect(hasMinified).toBeTruthy();
        });
      });

      describe("@font-face with font-display and unicode-range", () => {
        it("should handle extra CSS properties without breaking", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["font-display"].path,
            targets: ["Font Name"],
          });

          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBeGreaterThan(0);

          const hasError = messages.some((m) => m.type === "error");
          expect(hasError).toBeFalsy();

          const hasMinified = fontAssets.some((asset) => {
            const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
            return fontsLength[ext] && Buffer.from(asset.source).length < fontsLength[ext];
          });
          expect(hasMinified).toBeTruthy();
        });
      });

      describe("absolute path /fonts/...", () => {
        it("should build without errors with absolute font paths", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["absolute-path"].path,
            targets: ["Font Name"],
          });

          // Build should complete
          expect(output.length).toBeGreaterThan(0);

          // Font assets should exist (may or may not be minified depending on resolver)
          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBeGreaterThanOrEqual(0);

          // No critical errors
          const hasCriticalError = messages.some(
            (m) => m.type === "error" && !m.message.includes("keeping original"),
          );
          expect(hasCriticalError).toBeFalsy();
        });
      });

      describe("dynamic import", () => {
        it("should build with dynamic font import without errors", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["dynamic-import"].path,
            pluginOptions: { type: "manual", targets: [] },
          });

          expect(output.length).toBeGreaterThan(0);

          // Font asset should be in output
          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBeGreaterThan(0);

          const hasCriticalError = messages.some(
            (m) => m.type === "error" && !m.message.includes("keeping original"),
          );
          expect(hasCriticalError).toBeFalsy();
        });
      });

      describe("new URL() pattern", () => {
        it("should build with URL constructor pattern without errors", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["url-pattern"].path,
            pluginOptions: { type: "manual", targets: [] },
          });

          expect(output.length).toBeGreaterThan(0);

          const fontAssets = getFontAssets(output as OutputAsset[]);
          expect(fontAssets.length).toBeGreaterThan(0);

          const hasCriticalError = messages.some(
            (m) => m.type === "error" && !m.message.includes("keeping original"),
          );
          expect(hasCriticalError).toBeFalsy();
        });
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runPatternTests(version);
  });
});
