import { describe, it, expect } from "vitest";
import type { OutputAsset, OutputChunk } from "rollup";
import { createHash } from "node:crypto";
import {
  buildByVersion,
  collectFontReferences,
  type ContainerVersion,
  findBrokenFontReferences,
  fixtures,
  textFontsLength,
  viteBuild,
} from "./utils";

type OutputItem = OutputAsset | OutputChunk;

const ICON_TARGET = { fontName: "Font Name", ligatures: ["close"] };

const getFontAssets = (output: OutputItem[]): OutputAsset[] =>
  output.filter(
    (item): item is OutputAsset =>
      item.type === "asset" && /\.(?:woff2?|ttf|eot|otf)$/.test(item.fileName),
  );

const contentHash = (asset: OutputAsset): string =>
  createHash("sha256").update(Buffer.from(asset.source)).digest("hex");

const getEntryChunk = (output: OutputItem[]): OutputChunk | undefined =>
  output.find((item): item is OutputChunk => item.type === "chunk" && item.isEntry);

describe.sequential("Font references in build output", () => {
  const runReferenceTests = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      it("should minify each @font-face of one family from its own source file", async () => {
        const { output, messages } = await buildByVersion(version, {
          fixture: fixtures["multi-source"].path,
          pluginOptions: { type: "manual", targets: [ICON_TARGET] },
        });
        const items = output as OutputItem[];

        const woff2 = getFontAssets(items).filter((asset) => asset.fileName.endsWith(".woff2"));
        expect(woff2).toHaveLength(2);
        expect(contentHash(woff2[0])).not.toBe(contentHash(woff2[1]));
        expect(findBrokenFontReferences(items)).toEqual([]);
        expect(messages.filter((m) => m.type === "error")).toEqual([]);
      });

      it("should rewrite every occurrence of a font url in CSS", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["duplicate-url"].path,
          pluginOptions: { type: "manual", targets: [ICON_TARGET] },
        });
        const items = output as OutputItem[];

        const cssReferences = collectFontReferences(items).filter((ref) =>
          ref.from.endsWith(".css"),
        );
        expect(cssReferences).toHaveLength(2);
        expect(findBrokenFontReferences(items)).toEqual([]);
      });

      it("should keep a JS import with ?subset= pointing at the minified font", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["subset-js"].path,
          pluginOptions: { type: "manual", targets: [] },
        });
        const items = output as OutputItem[];

        const fontAssets = getFontAssets(items);
        expect(fontAssets).toHaveLength(1);
        expect(Buffer.from(fontAssets[0].source).length).toBeLessThan(textFontsLength.woff2);

        const entry = getEntryChunk(items);
        expect(entry).toBeDefined();
        const jsReferences = collectFontReferences([entry!]);
        expect(jsReferences.map((ref) => ref.path)).toEqual([fontAssets[0].fileName]);
        expect(entry!.code).not.toContain("?subset=");
        expect(findBrokenFontReferences(items)).toEqual([]);
      });

      it("should keep manifest entries pointing at emitted fonts", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["subset-js"].path,
          pluginOptions: { type: "manual", targets: [] },
          manifest: true,
        });
        const items = output as OutputItem[];

        const manifest = items.find((item) => item.fileName.endsWith("manifest.json"));
        expect(manifest).toBeDefined();
        const manifestReferences = collectFontReferences([manifest!]);
        expect(manifestReferences.length).toBeGreaterThan(0);
        expect(findBrokenFontReferences(items)).toEqual([]);
      });

      it("should skip SSR builds where fonts are not emitted", async () => {
        const { messages } = await buildByVersion(version, {
          fixture: fixtures["subset-js"].path,
          pluginOptions: { type: "manual", targets: [] },
          ssr: "index.js",
        });

        expect(messages.filter((m) => m.type === "warn" || m.type === "error")).toEqual([]);
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runReferenceTests(version);
  });
});
