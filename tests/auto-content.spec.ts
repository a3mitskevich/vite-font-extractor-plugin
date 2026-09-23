import { describe, it, expect } from "vitest";
import type { OutputAsset, RollupOutput } from "rollup";
import * as fontkit from "fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkIconGlyphs, formatGlyphs, splitGlyphTexts } from "../src/glyph-filter";
import {
  buildByVersion,
  type ContainerVersion,
  createFixture,
  findBrokenFontReferences,
  fixturesDir,
  fontsLength,
  type LoggerMessage,
  textFontsLength,
  viteBuild,
} from "./utils";

type Output = RollupOutput["output"];

const fixtures = {
  unrelated: createFixture("auto-content-unrelated", { fonts: [] }),
  parsing: createFixture("auto-content-parsing", { fonts: [] }),
  textFont: createFixture("auto-content-text-font", { fonts: [] }),
};

// Material Icons code points
const CLOSE = 0xe5cd;
const STAR = 0xe838;
const HOME = 0xe88a;
const MENU = 0xe5d2;
const PLAY_ARROW = 0xe037;
const DELETE = 0xe872;

const AUTO_MODE_NOTICE = '"auto" mode detected';

const build = (version: ContainerVersion, fixture: { path: string }) =>
  buildByVersion(version, { fixture: fixture.path, pluginOptions: { type: "auto", cache: false } });

const getFontAsset = (output: Output, prefix: string, ext: string): OutputAsset => {
  const asset = output.find(
    (item): item is OutputAsset =>
      item.type === "asset" && item.fileName.includes(prefix) && item.fileName.endsWith(`.${ext}`),
  );
  expect(asset, `${prefix}.${ext} in output`).toBeDefined();
  return asset!;
};

const openFont = (asset: OutputAsset): fontkit.Font =>
  fontkit.create(Buffer.from(asset.source)) as fontkit.Font;

const unexpectedMessages = (messages: LoggerMessage[]): LoggerMessage[] =>
  messages.filter(
    ({ type, message }) =>
      (type === "warn" || type === "error") && !message.includes(AUTO_MODE_NOTICE),
  );

const expectIconFontMinified = (output: Output): void => {
  for (const ext of ["woff2", "woff"] as const) {
    expect(Buffer.from(getFontAsset(output, "icon-font", ext).source).length).toBeLessThan(
      fontsLength[ext],
    );
  }
};

describe("checkIconGlyphs", () => {
  const read = (ext: string): Buffer =>
    readFileSync(join(fixturesDir, "fonts", `icon-font.${ext}`));
  const close = String.fromCodePoint(CLOSE);

  it("splits single code points and ligature texts", () => {
    expect(splitGlyphTexts([close, "close", close, "/", "😀"])).toEqual({
      raws: [close, "/", "😀"],
      ligatures: ["close"],
    });
  });

  ["woff2", "woff", "ttf"].forEach((ext) => {
    it(`keeps only glyphs the icon engine can extract (${ext})`, () => {
      const result = checkIconGlyphs(read(ext), {
        raws: [close, "/", "a", "😀"],
        ligatures: ["play_arrow", "nosuchicon"],
      });
      expect(result).toEqual({
        raws: [close],
        ligatures: ["play_arrow"],
        missing: ["/", "a", "😀", "nosuchicon"],
      });
    });
  });

  it("returns null for data that is not a font", () => {
    expect(checkIconGlyphs(Buffer.from("not a font"), { raws: [close], ligatures: [] })).toBeNull();
  });

  it("formats glyph lists", () => {
    expect(formatGlyphs(["/", "close", "😀"])).toBe('U+002F, "close", U+1F600');
    expect(formatGlyphs(Array.from({ length: 12 }, (_, i) => String(i % 10)))).toMatch(
      / and 2 more$/,
    );
  });
});

describe("Auto mode: CSS content", () => {
  Object.keys(viteBuild).forEach((version) => {
    describe(`vite@${version}`, () => {
      it("keeps the icon glyph when other CSS uses characters missing from the font", async () => {
        const { output, messages } = await build(version, fixtures.unrelated);

        expect(unexpectedMessages(messages)).toEqual([]);
        expect(findBrokenFontReferences(output)).toEqual([]);
        expectIconFontMinified(output);
        for (const ext of ["woff2", "woff"]) {
          const font = openFont(getFontAsset(output, "icon-font", ext));
          expect(font.hasGlyphForCodePoint(CLOSE)).toBe(true);
          expect(font.hasGlyphForCodePoint(STAR)).toBe(false);
        }
        const skipped = messages.filter(({ message }) => message.includes("not found in the font"));
        expect(skipped).toHaveLength(1);
        expect(skipped[0].type).toBe("info");
      });

      it("keeps every glyph referenced by content strings", async () => {
        const { output, messages } = await build(version, fixtures.parsing);

        expect(unexpectedMessages(messages)).toEqual([]);
        expect(findBrokenFontReferences(output)).toEqual([]);
        expectIconFontMinified(output);
        const font = openFont(getFontAsset(output, "icon-font", "woff2"));
        for (const codePoint of [HOME, MENU, CLOSE, STAR, PLAY_ARROW]) {
          expect(font.hasGlyphForCodePoint(codePoint), codePoint.toString(16)).toBe(true);
        }
        expect(font.hasGlyphForCodePoint(DELETE)).toBe(false);
        const playArrow = font.layout("play_arrow").glyphs;
        expect(playArrow).toHaveLength(1);
        expect(playArrow[0].id).not.toBe(0);
      });

      it("keeps a text font without auto-detected glyphs as is", async () => {
        const { output, messages } = await build(version, fixtures.textFont);

        expect(messages.filter(({ type }) => type === "error")).toEqual([]);
        const warnings = unexpectedMessages(messages);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].message).toContain('"Text"');
        expect(warnings[0].message).toContain("keeping original");
        expect(findBrokenFontReferences(output)).toEqual([]);
        expect(Buffer.from(getFontAsset(output, "text-font", "woff2").source).length).toBe(
          textFontsLength.woff2,
        );
        expectIconFontMinified(output);
        const font = openFont(getFontAsset(output, "icon-font", "woff2"));
        expect(font.hasGlyphForCodePoint(CLOSE)).toBe(true);
      });
    });
  });
});
