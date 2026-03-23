import { describe, it, expect } from "vitest";
import {
  extractFontFaces,
  extractFontName,
  extractFonts,
  extractGoogleFontsUrls,
  findUnicodeGlyphs,
  stripCssComments,
  camelCase,
  groupBy,
} from "../src/utils";

describe("extractFontFaces", () => {
  it("should extract a single @font-face block", () => {
    const css = `@font-face { font-family: 'Test'; src: url("test.woff2"); }`;
    const result = extractFontFaces(css);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("font-family");
  });

  it("should extract multiple @font-face blocks", () => {
    const css = `
      @font-face { font-family: 'A'; src: url("a.woff2"); }
      .some-class { color: red; }
      @font-face { font-family: 'B'; src: url("b.woff2"); }
    `;
    const result = extractFontFaces(css);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("'A'");
    expect(result[1]).toContain("'B'");
  });

  it("should return empty array for CSS without @font-face", () => {
    expect(extractFontFaces(".a { color: red; }")).toEqual([]);
  });

  it("should handle multiline @font-face blocks", () => {
    const css = `@font-face {
      font-family: 'Material Icons';
      src: url("./fonts/MaterialIcons-Regular.eot");
      src: url("./fonts/MaterialIcons-Regular.woff2") format("woff2"),
           url("./fonts/MaterialIcons-Regular.woff") format("woff");
    }`;
    const result = extractFontFaces(css);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("MaterialIcons-Regular.woff2");
  });

  it("should ignore @font-face inside CSS comments when pre-stripped", () => {
    const css = `
      /* @font-face { font-family: 'Commented'; src: url("no.woff2"); } */
      @font-face { font-family: 'Real'; src: url("yes.woff2"); }
    `;
    const result = extractFontFaces(stripCssComments(css));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("'Real'");
  });
});

describe("stripCssComments", () => {
  it("should remove single-line comments", () => {
    expect(stripCssComments("a { /* comment */ color: red; }")).toBe("a {  color: red; }");
  });

  it("should remove multi-line comments", () => {
    const css = `a {
  /* this is
     a multi-line comment */
  color: red;
}`;
    expect(stripCssComments(css)).toContain("color: red;");
    expect(stripCssComments(css)).not.toContain("multi-line");
  });

  it("should handle multiple comments", () => {
    const css = "/* first */ .b { /* second */ color: red; /* third */ }";
    const result = stripCssComments(css);
    expect(result).not.toContain("first");
    expect(result).not.toContain("second");
    expect(result).not.toContain("third");
    expect(result).toContain("color: red;");
  });

  it("should return unchanged string without comments", () => {
    expect(stripCssComments(".a { color: red; }")).toBe(".a { color: red; }");
  });
});

describe("extractFontName", () => {
  it("should extract font name with single quotes", () => {
    expect(extractFontName("font-family: 'Material Icons';")).toBe("Material Icons");
  });

  it("should extract font name with double quotes", () => {
    expect(extractFontName('font-family: "Roboto";')).toBe("Roboto");
  });

  it("should extract font name without quotes", () => {
    expect(extractFontName("font-family: Arial;")).toBe("Arial");
  });

  it("should return empty string for no font-family", () => {
    expect(extractFontName("src: url('test.woff2');")).toBe("");
  });

  it("should handle extra whitespace around value", () => {
    // Note: regex captures trailing spaces before semicolon, quotes are stripped
    expect(extractFontName("font-family:   'Noto Sans'  ;")).toBe("Noto Sans  ");
  });
});

describe("extractFonts", () => {
  it("should extract url from font-face src", () => {
    const face = `src: url("./fonts/font.woff2") format("woff2");`;
    expect(extractFonts(face)).toEqual(["./fonts/font.woff2"]);
  });

  it("should extract multiple urls", () => {
    const face = `
      src: url("font.eot");
      src: url("font.woff2") format("woff2"),
           url("font.woff") format("woff"),
           url("font.ttf") format("truetype");
    `;
    const result = extractFonts(face);
    expect(result).toEqual(["font.eot", "font.woff2", "font.woff", "font.ttf"]);
  });

  it("should handle urls with single quotes", () => {
    expect(extractFonts("src: url('test.woff2');")).toEqual(["test.woff2"]);
  });

  it("should handle urls without quotes", () => {
    expect(extractFonts("src: url(test.woff2);")).toEqual(["test.woff2"]);
  });

  it("should return empty array for no urls", () => {
    expect(extractFonts("font-family: 'Test';")).toEqual([]);
  });
});

describe("extractGoogleFontsUrls", () => {
  it("should extract Google Font url from CSS import", () => {
    const css = `@import "https://fonts.googleapis.com/icon?family=Material+Icons";`;
    const result = extractGoogleFontsUrls(css);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("fonts.googleapis.com");
  });

  it("should extract Google Font url with single quotes", () => {
    const css = `@import 'https://fonts.googleapis.com/css?family=Roboto';`;
    const result = extractGoogleFontsUrls(css);
    expect(result).toHaveLength(1);
  });

  it("should extract multiple Google Font urls", () => {
    const css = `
      @import "https://fonts.googleapis.com/icon?family=Material+Icons";
      @import "https://fonts.googleapis.com/css?family=Roboto";
    `;
    expect(extractGoogleFontsUrls(css)).toHaveLength(2);
  });

  it("should return empty array for non-Google fonts", () => {
    expect(extractGoogleFontsUrls(`@import "https://example.com/font.css";`)).toEqual([]);
  });

  it("should ignore Google Font urls inside CSS comments when pre-stripped", () => {
    const css = `
      /* @import "https://fonts.googleapis.com/css?family=Commented"; */
      @import "https://fonts.googleapis.com/css?family=Real";
    `;
    const result = extractGoogleFontsUrls(stripCssComments(css));
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("family=Real");
  });
});

describe("findUnicodeGlyphs", () => {
  it("should find unicode escape glyphs", () => {
    const css = `.icon::before { content: "\\e5cd"; }`;
    const result = findUnicodeGlyphs(css);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(String.fromCharCode(0xe5cd));
  });

  it("should find single character glyphs", () => {
    const css = `.icon::before { content: "X"; }`;
    const result = findUnicodeGlyphs(css);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("X");
  });

  it("should find multiple glyphs in same file", () => {
    const css = `
      .a::before { content: "\\e001"; }
      .b::after { content: "\\e002"; }
    `;
    const result = findUnicodeGlyphs(css);
    expect(result).toHaveLength(2);
  });

  it("should return empty array for CSS without content", () => {
    expect(findUnicodeGlyphs(".a { color: red; }")).toEqual([]);
  });

  it("should handle content with single quotes", () => {
    const css = `.icon::before { content: '\\e5cd'; }`;
    const result = findUnicodeGlyphs(css);
    expect(result).toHaveLength(1);
  });

  it("should ignore glyphs inside CSS comments when pre-stripped", () => {
    const css = `
      /* .commented { content: "\\e001"; } */
      .real { content: "\\e002"; }
    `;
    const result = findUnicodeGlyphs(stripCssComments(css));
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(String.fromCharCode(0xe002));
  });
});

describe("camelCase", () => {
  it("should convert space-separated to camelCase", () => {
    expect(camelCase("Material Icons")).toBe("materialIcons");
  });

  it("should convert hyphen-separated to camelCase", () => {
    expect(camelCase("font-name")).toBe("fontName");
  });

  it("should convert underscore-separated to camelCase", () => {
    expect(camelCase("font_name")).toBe("fontName");
  });

  it("should handle single word", () => {
    expect(camelCase("font")).toBe("font");
  });

  it("should lowercase first letter of PascalCase", () => {
    expect(camelCase("FontName")).toBe("fontName");
  });
});

describe("groupBy", () => {
  it("should group items by key", () => {
    const items = [
      { type: "a", value: 1 },
      { type: "b", value: 2 },
      { type: "a", value: 3 },
    ];
    const result = groupBy(items, (i) => i.type);
    expect(result).toEqual({
      a: [
        { type: "a", value: 1 },
        { type: "a", value: 3 },
      ],
      b: [{ type: "b", value: 2 }],
    });
  });

  it("should return empty object for empty array", () => {
    expect(groupBy([], () => "key")).toEqual({});
  });
});
