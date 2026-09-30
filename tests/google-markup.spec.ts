import { describe, it, expect, beforeAll } from "vitest";
import type { RollupOutput } from "rollup";
import { extractGoogleFontsUrls } from "../src/utils";
import { getGoogleFontFamilies, getGoogleFontText, setGoogleFontText } from "../src/google-fonts";
import { buildByVersion, createFixture, type LoggerMessage, viteBuild } from "./utils";

const ICONS = "https://fonts.googleapis.com/icon?family=Material+Icons";
const CSS2 =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&family=Material+Symbols+Rounded:wght@400;700&display=block";

describe("extractGoogleFontsUrls: markup", () => {
  it.each([
    ["href before rel", `<link href="${ICONS}" rel="stylesheet">`],
    ["rel before href", `<link rel="stylesheet" href="${ICONS}">`],
    ["unquoted attributes", `<link rel=stylesheet href=${ICONS}>`],
    ["single quotes", `<link href='${ICONS}' rel='stylesheet'>`],
    ["CSS url()", `@import url(${ICONS});`],
    ["CSS quoted url()", `@import url("${ICONS}");`],
    ["CSS string", `@import "${ICONS}";`],
  ])("finds the url only (%s)", (_, code) => {
    expect(extractGoogleFontsUrls(code)).toEqual([ICONS]);
  });

  it("finds every url of minified HTML", () => {
    const html = `<head><link href="${ICONS}" rel="stylesheet"><link href="${CSS2}" rel="stylesheet"></head>`;
    expect(extractGoogleFontsUrls(html)).toEqual([ICONS, CSS2]);
  });

  it("finds protocol-relative urls", () => {
    expect(extractGoogleFontsUrls(`<link href="//fonts.googleapis.com/icon?family=A">`)).toEqual([
      "//fonts.googleapis.com/icon?family=A",
    ]);
  });
});

describe("getGoogleFontFamilies", () => {
  it.each([
    [ICONS, ["Material Icons"]],
    [CSS2, ["Material Symbols Outlined", "Material Symbols Rounded"]],
    ["https://fonts.googleapis.com/css?family=Font+A|Font+B:400,700", ["Font A", "Font B"]],
    ["https://fonts.googleapis.com/css?family=Font+A%7CFont+B", ["Font A", "Font B"]],
    ["https://fonts.googleapis.com/css2?family=A&amp;family=B%20C", ["A", "B C"]],
    ["//fonts.googleapis.com/icon?family=Material+Icons", ["Material Icons"]],
    ["https://fonts.googleapis.com/icon", []],
  ])("reads families of %s", (url, families) => {
    expect(getGoogleFontFamilies(url)).toEqual(families);
  });
});

describe("setGoogleFontText", () => {
  it("appends text and keeps the rest of the url as written", () => {
    expect(setGoogleFontText(CSS2, "close star")).toBe(`${CSS2}&text=close+star`);
  });

  it("replaces an existing text", () => {
    const url = "https://fonts.googleapis.com/icon?family=A&text=old&display=swap";
    expect(getGoogleFontText(url)).toBe("old");
    expect(setGoogleFontText(url, "old close")).toBe(
      "https://fonts.googleapis.com/icon?family=A&display=swap&text=old+close",
    );
  });

  it("keeps HTML-escaped separators", () => {
    expect(setGoogleFontText("https://fonts.googleapis.com/css2?family=A&amp;family=B", "x")).toBe(
      "https://fonts.googleapis.com/css2?family=A&amp;family=B&amp;text=x",
    );
  });
});

const fixture = createFixture("google-markup", { fonts: [] });

const TARGETS = {
  "Material Icons": "close",
  "Material Icons Outlined": "star",
  "Material Icons Round": "home",
  "Material Symbols Outlined": "menu",
  "Material Symbols Rounded": "search",
  "Material Icons Sharp": "delete",
};

const GOOGLE_URL_IN_OUTPUT_RE = /https:\/\/fonts\.googleapis\.com\/[^\s"'`()<>]+/g;

const collectGoogleUrls = (output: RollupOutput["output"]): string[] =>
  output.flatMap((item) =>
    item.type === "asset" && typeof item.source === "string"
      ? Array.from(item.source.matchAll(GOOGLE_URL_IN_OUTPUT_RE), (match) => match[0])
      : [],
  );

describe("Google Fonts markup", () => {
  Object.keys(viteBuild).forEach((version) => {
    describe(`vite@${version}`, () => {
      let urls: string[] = [];
      let messages: LoggerMessage[] = [];

      beforeAll(async () => {
        const result = await buildByVersion(version, {
          fixture: fixture.path,
          pluginOptions: {
            type: "manual",
            cache: false,
            targets: Object.entries(TARGETS).map(([fontName, ligature]) => ({
              fontName,
              ligatures: [ligature],
            })),
          },
        });
        urls = collectGoogleUrls(result.output);
        messages = result.messages;
      });

      it("reports no warnings or errors", () => {
        expect(messages.filter(({ type }) => type !== "info")).toEqual([]);
      });

      it.each([
        ["one-line link, href first", "Material+Icons", "close"],
        ["one-line link, rel first", "Material+Icons+Outlined", "star"],
        ["link with unquoted rel", "Material+Icons+Round", "home"],
        ["CSS @import url()", "Material+Icons+Sharp", "delete"],
      ])("adds text to %s", (_, family, text) => {
        const url = urls.find((item) => item.includes(`family=${family}&text=`));
        expect(url, `${family} in ${urls.join("\n")}`).toBeDefined();
        expect(url!.endsWith(`&text=${text}`)).toBe(true);
      });

      it("adds text of both css2 families and keeps axes", () => {
        const url = urls.find((item) => item.includes("css2?"));
        expect(url).toBe(`${CSS2}&text=menu+search`);
      });
    });
  });
});
