import { describe, it, expect } from "vitest";
import type { OutputAsset, OutputChunk } from "rollup";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as fontkit from "fontkit";
import {
  buildByVersion,
  collectFontReferences,
  type ContainerVersion,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixtures,
  fixturesDir,
  fontsLength,
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

// Maps each @font-face family in the output CSS to the font file its src points at
const getFontFileByFamily = (output: OutputItem[]): Map<string, string> => {
  const css = output
    .filter((item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(".css"))
    .map((item) => String(item.source))
    .join("\n");
  const entries = Array.from(css.matchAll(/@font-face\s*\{[^}]*\}/g), ([block]) => {
    const family = /font-family\s*:\s*([^;}]+)/.exec(block)?.[1].replace(/["']/g, "").trim();
    const path = /assets\/[^"'`()\s?#]+?\.(?:woff2?|ttf|eot|otf)/.exec(block)?.[0];
    return [family ?? "", path ?? ""] as const;
  });
  return new Map(entries);
};

interface ManifestChunk {
  file: string;
  src?: string;
  assets?: string[];
}

const readManifest = (output: OutputItem[]): Record<string, ManifestChunk> => {
  const manifest = output.find((item) => item.fileName.endsWith("manifest.json")) as OutputAsset;
  return JSON.parse(String(manifest.source)) as Record<string, ManifestChunk>;
};

// A ligature is rendered when the text collapses into one existing glyph
const rendersLigature = (font: fontkit.Font, text: string): boolean => {
  const glyphs = font.layout(text).glyphs;
  return glyphs.length === 1 && glyphs[0].id !== 0;
};

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
        // Same family and options: one minified file shared by both @font-face rules
        expect(getFontAssets(items)).toHaveLength(1);
        expect(new Set(cssReferences.map((ref) => ref.path)).size).toBe(1);
        expect(findBrokenFontReferences(items)).toEqual([]);
      });

      it("should minify a file shared by families with different options separately", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["shared-file-families"].path,
          pluginOptions: {
            type: "manual",
            targets: [
              { fontName: "Icons A", ligatures: ["close"] },
              { fontName: "Icons B", ligatures: ["star"] },
            ],
          },
        });
        const items = output as OutputItem[];

        const fileByFamily = getFontFileByFamily(items);
        expect(fileByFamily.size).toBe(2);
        expect(fileByFamily.get("Icons A")).not.toBe(fileByFamily.get("Icons B"));
        expect(findBrokenFontReferences(items)).toEqual([]);

        const fontOf = (family: string) => {
          const asset = items.find((item) => item.fileName === fileByFamily.get(family));
          return fontkit.create(Buffer.from((asset as OutputAsset).source)) as fontkit.Font;
        };
        expect(rendersLigature(fontOf("Icons A"), "close")).toBe(true);
        expect(rendersLigature(fontOf("Icons A"), "star")).toBe(false);
        expect(rendersLigature(fontOf("Icons B"), "star")).toBe(true);
        expect(rendersLigature(fontOf("Icons B"), "close")).toBe(false);
      });

      it("should point every auto-mode family sharing a file at the minified font", async () => {
        const { output } = await buildByVersion(version, {
          fixture: join(fixturesDir, "shared-file-families-auto"),
          pluginOptions: { type: "auto" },
        });
        const items = output as OutputItem[];

        const fileByFamily = getFontFileByFamily(items);
        expect(fileByFamily.size).toBe(2);
        // Auto mode extracts one glyph set for every family: one file serves both
        expect(fileByFamily.get("Icons A")).toBe(fileByFamily.get("Icons B"));
        expect(getFontAssets(items)).toHaveLength(1);
        expect(findBrokenFontReferences(items)).toEqual([]);

        const asset = items.find((item) => item.fileName === fileByFamily.get("Icons B"));
        const font = fontkit.create(Buffer.from((asset as OutputAsset).source)) as fontkit.Font;
        expect(Buffer.from((asset as OutputAsset).source).length).toBeLessThan(fontsLength.woff2);
        expect(rendersLigature(font, "close")).toBe(true);
        expect(rendersLigature(font, "star")).toBe(true);
      });

      it("should keep the full file for a family without target sharing it", async () => {
        const { output, messages } = await buildByVersion(version, {
          fixture: join(fixturesDir, "shared-file-untargeted"),
          pluginOptions: { type: "manual", targets: [{ fontName: "Icons", ligatures: ["close"] }] },
        });
        const items = output as OutputItem[];

        const fileByFamily = getFontFileByFamily(items);
        expect(fileByFamily.get("Icons")).not.toBe(fileByFamily.get("IconsFull"));
        expect(findBrokenFontReferences(items)).toEqual([]);

        const assetOf = (family: string) =>
          items.find((item) => item.fileName === fileByFamily.get(family)) as OutputAsset;
        const fontOf = (family: string) =>
          fontkit.create(Buffer.from(assetOf(family).source)) as fontkit.Font;
        expect(Buffer.from(assetOf("IconsFull").source).length).toBe(fontsLength.woff2);
        expect(rendersLigature(fontOf("IconsFull"), "star")).toBe(true);
        expect(rendersLigature(fontOf("Icons"), "close")).toBe(true);
        expect(rendersLigature(fontOf("Icons"), "star")).toBe(false);
        // The only expected notice: the family has neither a target nor `?subset=`
        const problems = messages.filter((m) => m.type === "warn" || m.type === "error");
        expect(problems).toHaveLength(1);
        expect(problems[0].message).toContain('"IconsFull" has no minify options');
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

      it("should map each ?subset= of one file to its own minified font", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["subset-multi-js"].path,
          pluginOptions: { type: "manual", targets: [] },
        });
        const items = output as OutputItem[];

        const fontAssets = getFontAssets(items);
        expect(fontAssets).toHaveLength(2);
        expect(contentHash(fontAssets[0])).not.toBe(contentHash(fontAssets[1]));

        const entry = getEntryChunk(items)!;
        const jsPaths = collectFontReferences([entry]).map((ref) => ref.path);
        expect(new Set(jsPaths)).toEqual(new Set(fontAssets.map((asset) => asset.fileName)));
        expect(entry.code).not.toContain("?subset=");
        expect(findBrokenFontReferences(items)).toEqual([]);
      });

      it("should not rewrite a font whose file name ends with a minified file name", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["name-suffix"].path,
          pluginOptions: { type: "manual", targets: [ICON_TARGET], ignore: ["Text Font"] },
          config: {
            build: {
              rollupOptions: {
                output: {
                  // Hash-less names: the target `font.woff2` is a suffix of `text-font.woff2`
                  assetFileNames: (asset: { name?: string; names?: string[] }) =>
                    [...(asset.names ?? []), asset.name].includes("icon-font.woff2")
                      ? "assets/font[extname]"
                      : "assets/[name][extname]",
                },
              },
            },
          },
        });
        const items = output as OutputItem[];

        expect(getFontFileByFamily(items).get("Text Font")).toBe("assets/text-font.woff2");
        expect(getFontFileByFamily(items).get("Font Name")).not.toBe("assets/font.woff2");
        expect(findBrokenFontReferences(items)).toEqual([]);
        expect(findOrphanFontAssets(items)).toEqual([]);
      });

      it("should not rewrite a file name that ends with a minified name after @ or ~", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["name-delimiters"].path,
          pluginOptions: {
            type: "manual",
            targets: [{ fontName: "Text Font", engine: "subset", characters: "A" }],
          },
          manifest: true,
          config: {
            build: {
              assetsInlineLimit: 0,
              rollupOptions: { output: { assetFileNames: "assets/[name][extname]" } },
            },
          },
        });
        const items = output as OutputItem[];

        const entry = getEntryChunk(items)!;
        expect(entry.code).toContain("assets/x@text-font.woff2");
        expect(entry.code).toContain("assets/my~text-font.woff2");
        expect(findBrokenFontReferences(items)).toEqual([]);
        expect(findOrphanFontAssets(items)).toEqual([]);

        // Manifest keys and `src` are source paths and must stay as they are
        const manifest = readManifest(items);
        const fontEntry = manifest["../fonts/text-font.woff2"];
        expect(fontEntry?.src).toBe("../fonts/text-font.woff2");
        expect(items.map((item) => item.fileName)).toContain(fontEntry?.file);
      });

      it("should list the font a JS ?subset= import loads in the manifest", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["subset-js"].path,
          pluginOptions: { type: "manual", targets: [] },
          manifest: true,
        });
        const items = output as OutputItem[];

        const [font] = getFontAssets(items);
        expect(getFontAssets(items)).toHaveLength(1);
        expect(Buffer.from(font.source).length).toBeLessThan(textFontsLength.woff2);
        expect(readManifest(items)["index.html"]?.assets).toEqual([font.fileName]);
        expect(findBrokenFontReferences(items)).toEqual([]);
      });

      it("should point a JS ?subset= import at its own font with a relative base", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["subset-js-target"].path,
          pluginOptions: {
            type: "manual",
            targets: [{ fontName: "Text Font", engine: "subset", characters: "A" }],
          },
          config: { base: "./" },
        });
        const items = output as OutputItem[];

        const fontAssets = getFontAssets(items);
        expect(fontAssets).toHaveLength(2);
        const css = items.find((item) => item.fileName.endsWith(".css"))!;
        const entry = getEntryChunk(items)!;
        const [cssPath] = collectFontReferences([css], items).map((ref) => ref.path);
        const [jsPath] = collectFontReferences([entry], items).map((ref) => ref.path);
        expect(cssPath).not.toBe(jsPath);
        expect(new Set([cssPath, jsPath])).toEqual(
          new Set(fontAssets.map((asset) => asset.fileName)),
        );
        expect(entry.code).not.toContain("?subset=");
        expect(findBrokenFontReferences(items)).toEqual([]);
        expect(findOrphanFontAssets(items)).toEqual([]);
      });

      it("should keep other query params next to ?subset=", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["subset-query-params"].path,
          pluginOptions: { type: "manual", targets: [] },
        });
        const items = output as OutputItem[];

        const fontAssets = getFontAssets(items);
        expect(fontAssets).toHaveLength(2);
        for (const asset of fontAssets) {
          expect(Buffer.from(asset.source).length).toBeLessThan(textFontsLength.woff2);
        }
        const css = items.find((item): item is OutputAsset => item.fileName.endsWith(".css"))!;
        const cssCode = String(css.source);
        const entry = getEntryChunk(items)!;
        expect(cssCode).toMatch(/\.woff2\?v=1\b/);
        expect(entry.code).toMatch(/\.woff2\?v=2\b/);
        expect(cssCode + entry.code).not.toContain("subset=");
        expect(findBrokenFontReferences(items)).toEqual([]);
        expect(findOrphanFontAssets(items)).toEqual([]);
      });

      it("should strip ?subset= from CSS font urls", async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures["subset-chars"].path,
          pluginOptions: { type: "manual", targets: [] },
        });
        const items = output as OutputItem[];

        const css = items.find(
          (item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(".css"),
        );
        expect(css).toBeDefined();
        expect(String(css!.source)).not.toContain("?subset=");
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
