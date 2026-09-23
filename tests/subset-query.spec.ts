import { describe, it, expect, beforeAll } from "vitest";
import type { OutputAsset, RollupOutput } from "rollup";
import * as fontkit from "fontkit";
import { getSubsetKey, parseSubsetQuery } from "../src/utils";
import { extractAssetReferences } from "../src/asset-refs";
import {
  buildByVersion,
  createFixture,
  findBrokenFontReferences,
  type LoggerMessage,
  textFontsLength,
  viteBuild,
} from "./utils";

type Output = Array<RollupOutput["output"][number]>;

const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/g;
const FACE_FAMILY_RE = /font-family:\s*["']?([^;"'}]+)/;
const FACE_URL_RE = /url\(\s*["']?\/?([^"')]+?)["']?\s*\)/;

// font-family → file name referenced by its @font-face in the output CSS
const getFaceFiles = (output: Output): Map<string, string> => {
  const css = output
    .filter((item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(".css"))
    .map((item) => String(item.source))
    .join("\n");
  return new Map(
    Array.from(css.matchAll(FONT_FACE_RE), ([block]) => [
      FACE_FAMILY_RE.exec(block)?.[1].trim() ?? "",
      FACE_URL_RE.exec(block)?.[1] ?? "",
    ]),
  );
};

const getAsset = (output: Output, fileName: string): OutputAsset => {
  const asset = output.find(
    (item): item is OutputAsset => item.type === "asset" && item.fileName === fileName,
  );
  expect(asset, fileName).toBeDefined();
  return asset!;
};

const expectSubset = (asset: OutputAsset, characters: string): void => {
  const source = Buffer.from(asset.source);
  expect(source.length).toBeLessThan(textFontsLength.woff2);
  const font = fontkit.create(source) as fontkit.Font;
  for (const char of characters) {
    expect(font.hasGlyphForCodePoint(char.codePointAt(0)!), `"${char}"`).toBe(true);
  }
  expect(font.hasGlyphForCodePoint("Z".codePointAt(0)!)).toBe(false);
};

describe("parseSubsetQuery", () => {
  it("splits characters and ranges", () => {
    expect(parseSubsetQuery("ABC,U+0030-0039")).toEqual({
      characters: "ABC",
      unicodeRanges: ["U+0030-0039"],
    });
  });

  it("decodes percent-encoding after splitting by comma", () => {
    expect(parseSubsetQuery("a%2Cb,c")).toEqual({ characters: "a,bc", unicodeRanges: undefined });
    expect(parseSubsetQuery("A%20B")).toEqual({ characters: "A B", unicodeRanges: undefined });
    expect(parseSubsetQuery("%C3%A9")).toEqual({ characters: "é", unicodeRanges: undefined });
  });

  it("keeps text that is not valid percent-encoding", () => {
    expect(parseSubsetQuery("100%")).toEqual({ characters: "100%", unicodeRanges: undefined });
  });

  it("reads a CSS-escaped space", () => {
    expect(parseSubsetQuery("A\\ B")).toEqual({ characters: "A B", unicodeRanges: undefined });
  });

  it("normalizes ranges to upper case", () => {
    expect(parseSubsetQuery("u+0030-u+0039,U+00e9")).toEqual({
      characters: undefined,
      unicodeRanges: ["U+0030-U+0039", "U+00E9"],
    });
    expect(parseSubsetQuery("u%2B0041")).toEqual({
      characters: undefined,
      unicodeRanges: ["U+0041"],
    });
  });

  it("treats text that only looks like a range as characters", () => {
    expect(parseSubsetQuery("u+zz")).toEqual({ characters: "u+zz", unicodeRanges: undefined });
  });

  it("skips empty parts", () => {
    expect(parseSubsetQuery("A,,B,")).toEqual({ characters: "AB", unicodeRanges: undefined });
  });

  it("gives the same key to every form Vite writes a value in", () => {
    const key = getSubsetKey(parseSubsetQuery("A B"));
    for (const value of ["A%20B", "A\\ B"]) {
      expect(getSubsetKey(parseSubsetQuery(value))).toBe(key);
    }
  });
});

describe("extractAssetReferences: decoded queries", () => {
  it("reads a Vite 5-7 placeholder whose query has a space", () => {
    expect(extractAssetReferences(`url("__VITE_ASSET__BgWNIZOv__$_?subset=A B__")`)).toEqual([
      { referenceId: "BgWNIZOv", subset: { characters: "A B", unicodeRanges: undefined } },
    ]);
  });

  it("reads a Vite 8 CSS placeholder whose query has a space", () => {
    expect(
      extractAssetReferences(`url("__VITE_ASSET__VRAku6fj__?subset=A B") format("woff2")`),
    ).toEqual([
      { referenceId: "VRAku6fj", subset: { characters: "A B", unicodeRanges: undefined } },
    ]);
  });

  it("reads placeholders listed one per line", () => {
    const subset = { characters: "ABC", unicodeRanges: undefined };
    expect(
      extractAssetReferences("__VITE_ASSET__a__?subset=ABC\n__VITE_ASSET__b__?subset=ABC"),
    ).toEqual([
      { referenceId: "a", subset },
      { referenceId: "b", subset },
    ]);
  });
});

const encodedFixture = createFixture("subset-query-encoded", { fonts: [] });

// Vite 6–8 write `?subset=A B` (decoded) into the output; rewrite-refs.ts must accept spaces
// in the query before the "Space" face points to its minified file there
const REWRITES_DECODED_SPACES: Record<string, boolean> = { "5": true };

describe("?subset= encoding in builds", () => {
  Object.keys(viteBuild).forEach((version) => {
    describe(`vite@${version}`, () => {
      let output: Output = [];
      let messages: LoggerMessage[] = [];
      let faces = new Map<string, string>();

      beforeAll(async () => {
        const result = await buildByVersion(version, {
          fixture: encodedFixture.path,
          pluginOptions: { type: "manual", targets: [], cache: false },
        });
        output = result.output;
        messages = result.messages;
        faces = getFaceFiles(output);
      });

      it("has no broken references and no warnings", () => {
        expect(findBrokenFontReferences(output)).toEqual([]);
        expect(messages.filter(({ type }) => type !== "info")).toEqual([]);
      });

      it("requests a literal comma with %2C", () => {
        expectSubset(getAsset(output, faces.get("Comma")!), "a,b");
      });

      it("reads a lower-case u+ range", () => {
        expectSubset(getAsset(output, faces.get("Range")!), "0123456789");
      });

      const spaceTest = REWRITES_DECODED_SPACES[version.split(".")[0]] ? it : it.fails;
      spaceTest("decodes %20 to a space", () => {
        expectSubset(getAsset(output, faces.get("Space")!), "A B");
      });
    });
  });
});

const ignoreFixture = createFixture("subset-query-ignore", { fonts: [] });

describe("ignore with ?subset=", () => {
  Object.keys(viteBuild).forEach((version) => {
    it(`keeps an ignored family original on vite@${version}`, async () => {
      const { output, messages } = await buildByVersion(version, {
        fixture: ignoreFixture.path,
        pluginOptions: { type: "manual", targets: [], ignore: ["Ignored"], cache: false },
      });
      const faces = getFaceFiles(output);

      expect(findBrokenFontReferences(output)).toEqual([]);
      expect(messages.filter(({ type }) => type !== "info")).toEqual([]);
      const ignored = getAsset(output, faces.get("Ignored")!.split("?")[0]);
      expect(Buffer.from(ignored.source).length).toBe(textFontsLength.woff2);
      const kept = Buffer.from(getAsset(output, faces.get("Kept")!).source);
      expect(kept.length).toBeLessThan(textFontsLength.woff);
      const font = fontkit.create(kept) as fontkit.Font;
      expect(font.hasGlyphForCodePoint("X".codePointAt(0)!)).toBe(true);
      expect(font.hasGlyphForCodePoint("A".codePointAt(0)!)).toBe(false);
    });
  });
});
