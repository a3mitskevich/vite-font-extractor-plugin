import { describe, it, expect } from "vitest";
import type { OutputAsset } from "rollup";
import {
  buildByVersion,
  collectFontReferences,
  type ContainerVersion,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixtures,
  fontsLength,
  getFontAssets,
  type OutputItem,
  viteBuild,
} from "./utils";

const getCssSource = (output: OutputItem[]): string =>
  output
    .filter((item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(".css"))
    .map((item) => String(item.source))
    .join("\n");

const warningsAndErrors = (messages: { type: string; message: string }[]) =>
  messages.filter((m) => m.type === "warn" || m.type === "error");

describe.sequential("Font import patterns", () => {
  const runPatternTests = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      describe("multi-weight @font-face", () => {
        it("should process both weights of same font family", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["multi-weight"].path,
            targets: ["Font Name"],
          });
          const items = output as OutputItem[];

          const fontAssets = getFontAssets(items);
          expect(fontAssets).toHaveLength(4);
          expect(messages.filter((m) => m.type === "error")).toEqual([]);

          // Both @font-face blocks (all four formats) are minified
          fontAssets.forEach((asset) => {
            const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
            expect(Buffer.from(asset.source).length, asset.fileName).toBeLessThan(fontsLength[ext]);
          });
          expect(findBrokenFontReferences(items)).toEqual([]);
          expect(findOrphanFontAssets(items)).toEqual([]);
        });
      });

      describe("@font-face with font-display and unicode-range", () => {
        it("should handle extra CSS properties without breaking", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["font-display"].path,
            targets: ["Font Name"],
          });
          const items = output as OutputItem[];

          const fontAssets = getFontAssets(items);
          expect(fontAssets).toHaveLength(4);
          expect(messages.filter((m) => m.type === "error")).toEqual([]);

          fontAssets.forEach((asset) => {
            const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
            expect(Buffer.from(asset.source).length, asset.fileName).toBeLessThan(fontsLength[ext]);
          });
          expect(getCssSource(items)).toMatch(/font-display:\s*swap/);
          expect(findBrokenFontReferences(items)).toEqual([]);
          expect(findOrphanFontAssets(items)).toEqual([]);
        });
      });

      // Current behaviour: fonts served from `public/` are not part of the bundle,
      // so the plugin never sees them — they are neither minified nor reported
      describe("absolute path /fonts/... from public/", () => {
        it("should leave public fonts untouched and silent", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["absolute-path"].path,
            targets: ["Font Name"],
          });
          const items = output as OutputItem[];

          expect(getFontAssets(items)).toEqual([]);
          const css = getCssSource(items);
          ["eot", "woff2", "woff", "ttf"].forEach((ext) => {
            expect(css).toContain(`/fonts/icon-font.${ext}`);
          });
          expect(warningsAndErrors(messages)).toEqual([]);
          expect(messages.some((m) => m.message.includes("Minify"))).toBe(false);
        });
      });

      // JS-only imports without `?subset=` have no font-family and pass through unchanged
      describe("dynamic import", () => {
        it("should emit the dynamically imported font unchanged", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["dynamic-import"].path,
            pluginOptions: { type: "manual", targets: [] },
          });
          const items = output as OutputItem[];

          const fontAssets = getFontAssets(items);
          expect(fontAssets).toHaveLength(1);
          expect(Buffer.from(fontAssets[0].source).length).toBe(fontsLength.woff2);

          const lazyChunk = items.find(
            (item) => item.type === "chunk" && item.isDynamicEntry && !item.isEntry,
          );
          expect(lazyChunk).toBeDefined();
          expect(collectFontReferences([lazyChunk!], items).map((ref) => ref.path)).toEqual([
            fontAssets[0].fileName,
          ]);
          expect(findBrokenFontReferences(items)).toEqual([]);
          expect(warningsAndErrors(messages)).toEqual([]);
        });
      });

      describe("new URL() pattern", () => {
        it("should emit the font referenced by new URL() unchanged", async () => {
          const { output, messages } = await buildByVersion(version, {
            fixture: fixtures["url-pattern"].path,
            pluginOptions: { type: "manual", targets: [] },
          });
          const items = output as OutputItem[];

          const fontAssets = getFontAssets(items);
          expect(fontAssets).toHaveLength(1);
          expect(Buffer.from(fontAssets[0].source).length).toBe(fontsLength.woff2);

          const entry = items.find((item) => item.type === "chunk" && item.isEntry);
          expect(entry).toBeDefined();
          expect(collectFontReferences([entry!], items).map((ref) => ref.path)).toEqual([
            fontAssets[0].fileName,
          ]);
          expect(findBrokenFontReferences(items)).toEqual([]);
          expect(warningsAndErrors(messages)).toEqual([]);
        });
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runPatternTests(version);
  });
});
