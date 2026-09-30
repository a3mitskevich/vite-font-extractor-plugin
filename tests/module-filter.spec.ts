import { describe, it, expect } from "vitest";
import { join } from "node:path";
import type { PluginOption } from "../src";
import {
  buildFixture,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixtures,
  fixturesDir,
  fontsLength,
  getFontAssets,
  openFont,
  type OutputAsset,
  type OutputItem,
  rendersLigature,
  textFontsLength,
} from "./utils";

const fixture = join(fixturesDir, "module-filter");
const targets = [
  { fontName: "App Icons", ligatures: ["close"] },
  { fontName: "Vendor Icons", ligatures: ["close"] },
];

const build = async (pluginOptions: PluginOption, root = fixture) => {
  const { output, messages } = await buildFixture({ fixture: root, pluginOptions });
  const items = output as OutputItem[];
  expect(findBrokenFontReferences(items)).toEqual([]);
  expect(findOrphanFontAssets(items)).toEqual([]);
  return { items, messages };
};

const fontOf = (items: OutputItem[], extension: string): OutputAsset => {
  const font = getFontAssets(items).find((asset) => asset.fileName.endsWith(`.${extension}`));
  if (!font) throw new Error(`No .${extension} font in the output`);
  return font;
};

describe("include / exclude", () => {
  it("should minify the fonts of every stylesheet without them", async () => {
    const { items } = await build({ type: "manual", targets });
    expect(fontOf(items, "woff2").source.length).toBeLessThan(fontsLength.woff2);
    expect(fontOf(items, "woff").source.length).toBeLessThan(fontsLength.woff);
  });

  const cases: Array<[string, Pick<PluginOption, "include" | "exclude">]> = [
    ["an exclude glob", { exclude: "vendor/**" }],
    ["an exclude RegExp", { exclude: /\/vendor\// }],
    ["an include glob", { include: ["src/**"] }],
    ["an include RegExp", { include: /\/src\/.*\.css$/ }],
  ];
  it.each(cases)("should keep the font of a stylesheet outside %s original", async (_, filter) => {
    const { items, messages } = await build({ type: "manual", targets, ...filter });

    const app = fontOf(items, "woff2");
    expect(app.source.length).toBeLessThan(fontsLength.woff2);
    expect(rendersLigature(openFont(app.source), "close")).toBe(true);
    expect(fontOf(items, "woff").source.length).toBe(fontsLength.woff);
    // A skipped stylesheet is not a problem to report
    expect(messages.filter((m) => m.type === "warn" || m.type === "error")).toEqual([]);
  });

  it("should still collect auto glyphs from an excluded stylesheet", async () => {
    const { items } = await build({ type: "auto", exclude: "vendor/**" });

    const app = openFont(fontOf(items, "woff2").source);
    expect(rendersLigature(app, "close")).toBe(true);
    // `content: "play_arrow"` of the excluded vendor stylesheet counts for the fonts of the app
    expect(rendersLigature(app, "play_arrow")).toBe(true);
    expect(fontOf(items, "woff").source.length).toBe(fontsLength.woff);
  });

  it("should leave a JS ?subset= import of a module outside include original", async () => {
    const { items } = await build(
      { type: "manual", targets: [], include: "**/*.css" },
      fixtures["subset-js"].path,
    );
    expect(fontOf(items, "woff2").source.length).toBe(textFontsLength.woff2);
  });

  it("should leave a JS ?subset= import of an excluded module original", async () => {
    const { items } = await build(
      { type: "manual", targets: [], exclude: /index\.js$/ },
      fixtures["subset-js"].path,
    );
    expect(fontOf(items, "woff2").source.length).toBe(textFontsLength.woff2);
  });

  it("should leave a new URL() with ?subset= of an excluded module original", async () => {
    const { items } = await build(
      { type: "manual", targets: [], exclude: "index.js" },
      join(fixturesDir, "subset-new-url"),
    );
    for (const font of getFontAssets(items)) {
      expect(font.source.length, font.fileName).toBe(textFontsLength.woff2);
    }
  });
});
