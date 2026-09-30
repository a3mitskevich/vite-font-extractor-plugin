import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { PluginOption } from "../src";
import {
  buildFixture,
  collectFontReferences,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixturesDir,
  generateId,
  getFontAssets,
  type OutputItem,
  outDir,
} from "./utils";

// The goal of the package (README → "Goal"): a changed minified font renames the font and every
// file that loads it; an unchanged result keeps every name

const ICONS_TARGETS = (ligatures: string[]): PluginOption => ({
  type: "manual",
  targets: [
    { fontName: "Icons", ligatures },
    { fontName: "Partial Icons", ligatures: ["play_arrow"] },
  ],
  cache: false,
});

const createProject = (): string => {
  const root = join(outDir, `goal-${generateId()}`);
  cpSync(join(fixturesDir, "goal"), root, { recursive: true });
  mkdirSync(join(root, "fonts"));
  const fonts = join(fixturesDir, "fonts");
  cpSync(join(fonts, "icon-font.woff2"), join(root, "fonts", "icons.woff2"));
  cpSync(join(fonts, "icon-font.woff"), join(root, "fonts", "icons.woff"));
  cpSync(join(fonts, "icon-font.woff2"), join(root, "fonts", "partial.woff2"));
  cpSync(join(fonts, "text-font.woff2"), join(root, "fonts", "js-font.woff2"));
  return root;
};

interface Snapshot {
  output: OutputItem[];
  names: string[];
  contents: Map<string, string>;
}

const contentOf = (item: OutputItem): string =>
  item.type === "chunk" ? item.code : Buffer.from(item.source).toString("base64");

const snapshotBuild = async (root: string, pluginOptions: PluginOption): Promise<Snapshot> => {
  const { output } = await buildFixture({ fixture: root, pluginOptions, manifest: true });
  const items = output as OutputItem[];
  expect(findBrokenFontReferences(items)).toEqual([]);
  expect(findOrphanFontAssets(items)).toEqual([]);
  return {
    output: items,
    names: items.map((item) => item.fileName).sort(),
    contents: new Map(items.map((item) => [item.fileName, contentOf(item)])),
  };
};

const find = (snapshot: Snapshot, pattern: RegExp): string[] =>
  snapshot.names.filter((name) => pattern.test(name));

const one = (snapshot: Snapshot, pattern: RegExp): string => {
  const names = find(snapshot, pattern);
  expect(names, String(pattern)).toHaveLength(1);
  return names[0];
};

// Font files the output items matching `from` point at
const fontsReferencedFrom = (snapshot: Snapshot, from: RegExp): string[] =>
  [
    ...new Set(
      collectFontReferences(snapshot.output)
        .filter((ref) => from.test(ref.from))
        .map((ref) => ref.path),
    ),
  ].sort();

const MANIFEST = ".vite/manifest.json";
const ENTRY_JS = /^assets\/index-[\w-]+\.js$/;
const ICONS_WOFF2 = /^assets\/icons-[\w-]+\.woff2$/;
const JS_FONT = /^assets\/js-font-[\w-]+\.woff2$/;

describe("Goal: file names follow the minified fonts", () => {
  let root = "";
  let base: Snapshot;

  beforeAll(async () => {
    root = createProject();
    base = await snapshotBuild(root, ICONS_TARGETS(["close"]));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("covers every way a font is referenced", () => {
    // @font-face of a CSS module, of a Sass partial, a JS ?subset= import and an HTML preload
    expect(find(base, ICONS_WOFF2)).toHaveLength(1);
    expect(find(base, /^assets\/icons-[\w-]+\.woff$/)).toHaveLength(1);
    expect(find(base, /^assets\/partial-[\w-]+\.woff2$/)).toHaveLength(1);
    expect(find(base, JS_FONT)).toHaveLength(1);
    expect(fontsReferencedFrom(base, /^index\.html$/)).toEqual([one(base, ICONS_WOFF2)]);
    expect(fontsReferencedFrom(base, /\.js$/)).toEqual([one(base, JS_FONT)]);
    // Only minified fonts are emitted
    expect(getFontAssets(base.output)).toHaveLength(4);
  });

  it("keeps every name and byte when nothing changed", async () => {
    const again = await snapshotBuild(root, ICONS_TARGETS(["close"]));
    expect(again.names).toEqual(base.names);
    for (const [name, content] of base.contents) {
      expect(again.contents.get(name), name).toBe(content);
    }
  });

  it("renames the font, the CSS and the JS that imports it, updates HTML and manifest when only the glyph set changes", async () => {
    const changed = await snapshotBuild(root, ICONS_TARGETS(["close", "star"]));

    // The fonts of the changed target and the CSS that loads them get new names
    const iconsBefore = find(base, /^assets\/icons-/);
    const iconsAfter = find(changed, /^assets\/icons-/);
    expect(iconsAfter).toHaveLength(2);
    iconsAfter.forEach((name) => expect(iconsBefore).not.toContain(name));
    const cssBefore = one(base, /\.css$/);
    const cssAfter = one(changed, /\.css$/);
    expect(cssAfter).not.toBe(cssBefore);
    expect(fontsReferencedFrom(changed, /\.css$/)).toEqual(expect.arrayContaining(iconsAfter));

    // HTML and manifest are not content-hashed: their content points at the new files
    const html = changed.contents.get("index.html")!;
    expect(Buffer.from(html, "base64").toString()).toContain(cssAfter);
    expect(fontsReferencedFrom(changed, /^index\.html$/)).toEqual([one(changed, ICONS_WOFF2)]);
    const manifest = Buffer.from(changed.contents.get(MANIFEST)!, "base64").toString();
    expect(manifest).toContain(cssAfter);
    iconsAfter.forEach((name) => expect(manifest).toContain(name));
    expect(manifest).not.toContain(cssBefore);
    iconsBefore.forEach((name) => expect(manifest).not.toContain(name));

    // Vite hashes the names of a chunk's CSS into the chunk: the entry that imports it follows
    expect(one(changed, ENTRY_JS)).not.toBe(one(base, ENTRY_JS));
    expect(manifest).toContain(one(changed, ENTRY_JS));

    // Fonts the change does not touch keep their names
    expect(one(changed, /^assets\/partial-/)).toBe(one(base, /^assets\/partial-/));
    expect(one(changed, JS_FONT)).toBe(one(base, JS_FONT));
  });

  it("renames the font and the JS chunk when the font file of a JS import changes", async () => {
    const project = createProject();
    try {
      const before = await snapshotBuild(project, ICONS_TARGETS(["close"]));
      // Same `?subset=ABC`, another font file behind the same path
      cpSync(join(fixturesDir, "fonts", "text-font.woff"), join(project, "fonts", "js-font.woff2"));
      const after = await snapshotBuild(project, ICONS_TARGETS(["close"]));

      expect(one(after, JS_FONT)).not.toBe(one(before, JS_FONT));
      expect(one(after, ENTRY_JS)).not.toBe(one(before, ENTRY_JS));
      expect(fontsReferencedFrom(after, /\.js$/)).toEqual([one(after, JS_FONT)]);
      // The stylesheet does not load that font
      expect(one(after, /\.css$/)).toBe(one(before, /\.css$/));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
