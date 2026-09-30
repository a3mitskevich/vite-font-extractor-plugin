import { describe, it, expect } from "vitest";
import type { OutputAsset, OutputChunk } from "rollup";
import type { PluginOption } from "../src";
import {
  buildByVersion,
  collectFontReferences,
  type ContainerVersion,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixtures,
  getFontAssets,
  getFontFilesByFamily,
  getOutputAsset,
  hasAnyGlyphFor,
  hasGlyphsFor,
  openFont,
  type OutputItem,
  textFontsLength,
  viteBuild,
} from "./utils";

const LETTERS = "ABCabc";
const DIGITS = "0123456789";

interface GlyphExpectation {
  // Every character must be in the font
  present: string;
  // None of these characters may be in the font
  absent: string;
}

const getCssSource = (output: OutputItem[]): string =>
  output
    .filter((item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(".css"))
    .map((item) => String(item.source))
    .join("\n");

const getEntryChunk = (output: OutputItem[]): OutputChunk => {
  const entry = output.find((item): item is OutputChunk => item.type === "chunk" && item.isEntry);
  if (!entry) throw new Error("Entry chunk not found in build output");
  return entry;
};

const expectMinified = (asset: OutputAsset): void => {
  const ext = asset.fileName.split(".").pop() as keyof typeof textFontsLength;
  const size = Buffer.from(asset.source).length;
  expect(size).toBeGreaterThan(0);
  expect(size).toBeLessThan(textFontsLength[ext]);
};

const expectGlyphs = (asset: OutputAsset, { present, absent }: GlyphExpectation): void => {
  const font = openFont(asset.source);
  expect(hasGlyphsFor(font, present), `${asset.fileName} has "${present}"`).toBe(true);
  expect(hasAnyGlyphFor(font, absent), `${asset.fileName} has none of "${absent}"`).toBe(false);
};

// References resolve, nothing is left behind, `?subset=` never reaches the output
const expectCleanOutput = (output: OutputItem[]): void => {
  expect(findBrokenFontReferences(output)).toEqual([]);
  expect(findOrphanFontAssets(output)).toEqual([]);
  output
    .filter((item) => !getFontAssets([item]).length)
    .forEach((item) => {
      const text = item.type === "chunk" ? item.code : String(item.source);
      expect(text, item.fileName).not.toContain("?subset=");
    });
};

describe.sequential("Font subsetting", () => {
  const runSubsetTest = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      const build = async (fixture: string, pluginOptions: PluginOption) => {
        const { output, messages } = await buildByVersion(version, { fixture, pluginOptions });
        expect(messages.filter((m) => m.type === "error" || m.type === "warn")).toEqual([]);
        return output as OutputItem[];
      };

      // Every format in the output is minified to the same glyph set and referenced from CSS
      const expectCssSubset = (output: OutputItem[], glyphs: GlyphExpectation): void => {
        const fontAssets = getFontAssets(output);
        expect(fontAssets.map((asset) => asset.fileName.split(".").pop()).sort()).toEqual([
          "woff",
          "woff2",
        ]);
        const css = getCssSource(output);
        fontAssets.forEach((asset) => {
          expectMinified(asset);
          expectGlyphs(asset, glyphs);
          expect(css).toContain(asset.fileName);
        });
        expectCleanOutput(output);
      };

      describe("?subset=<chars>", () => {
        it("should keep exactly the requested characters", async () => {
          const output = await build(fixtures["subset-chars"].path, {
            type: "manual",
            targets: [{ fontName: "Text Font" }],
          });
          expectCssSubset(output, { present: "ABC", absent: `abcXYZ${DIGITS}` });
        });
      });

      describe("?subset=<unicode-range>", () => {
        it("should keep exactly the requested range", async () => {
          const output = await build(fixtures["subset-range"].path, {
            type: "manual",
            targets: [{ fontName: "Text Font" }],
          });
          expectCssSubset(output, { present: "ABCMXYZ", absent: `abcxyz${DIGITS}` });
        });
      });

      describe("?subset=<chars>,<range> combined", () => {
        it("should keep the characters and the range", async () => {
          const output = await build(fixtures["subset-combined"].path, {
            type: "manual",
            targets: [{ fontName: "Text Font" }],
          });
          expectCssSubset(output, { present: "ABCabcmxyz", absent: `DEFXYZ${DIGITS}` });
        });
      });

      describe("Target.characters config", () => {
        it("should subset by the target characters without ?subset=", async () => {
          const output = await build(fixtures["subset-target-chars"].path, {
            type: "manual",
            targets: [{ fontName: "Text Font", characters: LETTERS, engine: "subset" }],
          });
          expectCssSubset(output, { present: LETTERS, absent: `DEFxyz${DIGITS}` });
        });
      });

      describe("multiple different ?subset= for same file (CSS)", () => {
        it("should produce separate minified assets per subset", async () => {
          const output = await build(fixtures["subset-multi-css"].path, {
            type: "manual",
            targets: [{ fontName: "Text Latin" }, { fontName: "Text Digits" }],
          });

          const byFamily = getFontFilesByFamily(output);
          const [latin] = byFamily.get("Text Latin") ?? [];
          const [digits] = byFamily.get("Text Digits") ?? [];
          expect(getFontAssets(output)).toHaveLength(2);
          expect(latin).toBeDefined();
          expect(latin).not.toBe(digits);

          expectMinified(getOutputAsset(output, latin));
          expectGlyphs(getOutputAsset(output, latin), { present: LETTERS, absent: DIGITS });
          expectMinified(getOutputAsset(output, digits));
          expectGlyphs(getOutputAsset(output, digits), { present: DIGITS, absent: LETTERS });
          expectCleanOutput(output);
        });
      });

      describe("same ?subset= for same file (CSS dedup)", () => {
        it("should deduplicate to one minified asset referenced by both @font-face", async () => {
          const output = await build(fixtures["subset-same-css"].path, {
            type: "manual",
            targets: [{ fontName: "Font A" }, { fontName: "Font B" }],
          });

          const fontAssets = getFontAssets(output);
          expect(fontAssets).toHaveLength(1);
          const byFamily = getFontFilesByFamily(output);
          expect(byFamily.get("Font A")).toEqual([fontAssets[0].fileName]);
          expect(byFamily.get("Font B")).toEqual([fontAssets[0].fileName]);

          expectMinified(fontAssets[0]);
          expectGlyphs(fontAssets[0], { present: LETTERS, absent: DIGITS });
          expectCleanOutput(output);
        });
      });

      describe("same ?subset= for same file (JS dedup)", () => {
        it("should deduplicate to one font asset with clean URLs", async () => {
          const output = await build(fixtures["subset-same-js"].path, {
            type: "manual",
            targets: [],
          });

          const fontAssets = getFontAssets(output);
          expect(fontAssets).toHaveLength(1);
          const jsPaths = collectFontReferences([getEntryChunk(output)]).map((ref) => ref.path);
          expect(new Set(jsPaths)).toEqual(new Set([fontAssets[0].fileName]));

          expectMinified(fontAssets[0]);
          expectGlyphs(fontAssets[0], { present: LETTERS, absent: DIGITS });
          expectCleanOutput(output);
        });
      });

      describe("multiple different ?subset= for same file (JS)", () => {
        it("should produce one minified asset per subset with clean URLs", async () => {
          const output = await build(fixtures["subset-multi-js"].path, {
            type: "manual",
            targets: [],
          });

          const fontAssets = getFontAssets(output);
          expect(fontAssets).toHaveLength(2);
          const jsPaths = collectFontReferences([getEntryChunk(output)]).map((ref) => ref.path);
          expect(new Set(jsPaths)).toEqual(new Set(fontAssets.map((asset) => asset.fileName)));

          const hasLetters = (asset: OutputAsset) => hasGlyphsFor(openFont(asset.source), LETTERS);
          const latin = fontAssets.filter(hasLetters);
          const digits = fontAssets.filter((asset) => !hasLetters(asset));
          expect(latin).toHaveLength(1);
          expect(digits).toHaveLength(1);
          expectGlyphs(latin[0], { present: LETTERS, absent: DIGITS });
          expectGlyphs(digits[0], { present: DIGITS, absent: LETTERS });
          fontAssets.forEach(expectMinified);
          expectCleanOutput(output);
        });
      });

      describe("JS import with ?subset=", () => {
        it("should produce font asset with clean URL in JS", async () => {
          const output = await build(fixtures["subset-js"].path, { type: "manual", targets: [] });

          const fontAssets = getFontAssets(output);
          expect(fontAssets).toHaveLength(1);
          const jsPaths = collectFontReferences([getEntryChunk(output)]).map((ref) => ref.path);
          expect(jsPaths).toEqual([fontAssets[0].fileName]);

          expectMinified(fontAssets[0]);
          expectGlyphs(fontAssets[0], { present: "ABC", absent: `abc${DIGITS}` });
          expectCleanOutput(output);
        });
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runSubsetTest(version);
  });
});
