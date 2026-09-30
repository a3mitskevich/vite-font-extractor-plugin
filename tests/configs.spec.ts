import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OutputAsset } from "./utils";
import type { PluginOption } from "../src";
import {
  buildFixture,
  collectFontReferences,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixtures,
  fixturesDir,
  fontsLength,
  generateId,
  getFontAssets,
  getReadableFontAssets,
  type InlineConfig,
  openFont,
  type OutputItem,
  outDir,
  rendersLigature,
} from "./utils";

const PLUGIN_OPTIONS: PluginOption = {
  type: "manual",
  targets: [{ fontName: "Icons", ligatures: ["close"] }],
  cache: false,
};

const CDN = "https://cdn.example.com";

interface Scenario {
  fixture: () => string;
  config?: InlineConfig;
  // Warnings the scenario triggers on purpose; each must appear, nothing else may
  expectedWarnings?: RegExp[];
  check?: (outputs: OutputItem[][]) => void;
}

const textOf = (output: OutputItem[], predicate: (fileName: string) => boolean): string =>
  output
    .filter((item) => predicate(item.fileName))
    .map((item) => (item.type === "chunk" ? item.code : String(item.source)))
    .join("\n");

const cssOf = (output: OutputItem[]) => textOf(output, (name) => name.endsWith(".css"));
const jsOf = (output: OutputItem[]) => textOf(output, (name) => name.endsWith(".js"));

const fontNamesOf = (output: OutputItem[]) =>
  getFontAssets(output).map((asset) => asset.fileName.slice(asset.fileName.lastIndexOf("/") + 1));

// A project whose font files have spaces in their names (copied at runtime, kept out of git)
let spacesProject = "";
const createSpacesProject = (): string => {
  const root = join(outDir, `configs-spaces-${generateId()}`);
  mkdirSync(join(root, "fonts"), { recursive: true });
  for (const ext of ["woff2", "woff"]) {
    copyFileSync(
      join(fixturesDir, "fonts", `icon-font.${ext}`),
      join(root, "fonts", `my icon font.${ext}`),
    );
  }
  writeFileSync(
    join(root, "index.html"),
    '<!DOCTYPE html><html><head><link href="./index.css" rel="stylesheet"></head></html>',
  );
  writeFileSync(
    join(root, "index.css"),
    `@font-face { font-family: 'Icons'; src: url("./fonts/my icon font.woff2") format("woff2"), url("./fonts/my icon font.woff") format("woff"); }
.icon { font-family: 'Icons'; }`,
  );
  return root;
};

const scenarios: Record<string, Scenario> = {
  'base: "./"': {
    fixture: () => fixtures.configs.path,
    config: { base: "./" },
    check: ([output]) => {
      // CSS in assets/ points at its sibling fonts
      expect(cssOf(output)).toMatch(/url\(\.\/icon-font-[\w-]+\.woff2\)/);
      expect(cssOf(output)).not.toContain("/assets/icon-font");
    },
  },
  "CDN base": {
    fixture: () => fixtures.configs.path,
    config: { base: `${CDN}/app/` },
    check: ([output]) => {
      expect(cssOf(output)).toMatch(
        /url\(https:\/\/cdn\.example\.com\/app\/assets\/icon-font-[\w-]+\.woff2\)/,
      );
    },
  },
  "experimental.renderBuiltUrl": {
    fixture: () => fixtures.configs.path,
    config: {
      experimental: {
        renderBuiltUrl: (fileName: string, { hostType }: { hostType: string }) =>
          hostType === "js"
            ? { runtime: `window.__cdn(${JSON.stringify(fileName)})` }
            : `${CDN}/${fileName}`,
      },
    },
    check: ([output]) => {
      expect(cssOf(output)).toMatch(
        /url\(https:\/\/cdn\.example\.com\/assets\/icon-font-[\w-]+\.woff2\)/,
      );
      expect(jsOf(output)).toMatch(/window\.__cdn\(["`]assets\/icon-font-[\w-]+\.woff2["`]\)/);
    },
  },
  "build.sourcemap: true": {
    fixture: () => fixtures.configs.path,
    config: { build: { sourcemap: true } },
    check: ([output]) => {
      expect(output.some((item) => item.fileName.endsWith(".js.map"))).toBe(true);
    },
  },
  "build.minify: false": {
    fixture: () => fixtures.configs.path,
    config: { build: { minify: false, cssMinify: false } },
  },
  'css.transformer: "lightningcss"': {
    fixture: () => fixtures.configs.path,
    config: { css: { transformer: "lightningcss" } },
  },
  "array of rollupOptions.output": {
    fixture: () => fixtures.configs.path,
    config: {
      build: {
        rollupOptions: {
          output: [
            { assetFileNames: "a/[name]-[hash][extname]", entryFileNames: "a/[name].js" },
            { assetFileNames: "b/[name]-[hash][extname]", entryFileNames: "b/[name].js" },
          ],
        },
      },
    },
    // Vite itself warns about differing assetFileNames across outputs
    expectedWarnings: [/assetFileNames isn't equal for every build\.rolldownOptions/],
    check: (outputs) => {
      expect(outputs).toHaveLength(2);
      const [a, b] = outputs;
      getFontAssets(a).forEach((asset) => expect(asset.fileName).toMatch(/^a\//));
      getFontAssets(b).forEach((asset) => expect(asset.fileName).toMatch(/^b\//));
      // Fonts are emitted once, before the outputs are rendered: same files in both
      expect(fontNamesOf(a).sort()).toEqual(fontNamesOf(b).sort());
    },
  },
  "spaces in the font file name": {
    fixture: () => spacesProject,
    check: ([output]) => {
      expect(fontNamesOf(output).every((name) => name.startsWith("my icon font-"))).toBe(true);
      expect(cssOf(output)).toContain("my%20icon%20font-");
    },
  },
  "CSS Modules": {
    fixture: () => fixtures["configs-css-modules"].path,
    check: ([output]) => {
      expect(cssOf(output)).toContain("@font-face");
    },
  },
  "CSS ?inline": {
    fixture: () => fixtures["configs-css-inline"].path,
    check: ([output]) => {
      // The stylesheet lives in JS as a string; no CSS asset is emitted
      expect(cssOf(output)).toBe("");
      expect(jsOf(output)).toContain("@font-face");
    },
  },
  "CSS of a lazy chunk": {
    fixture: () => fixtures["configs-lazy-css"].path,
    check: ([output]) => {
      const lazy = output.find(
        (item) => item.type === "chunk" && item.isDynamicEntry && item.fileName.includes("lazy"),
      );
      expect(lazy).toBeDefined();
      expect(cssOf(output)).toContain("@font-face");
    },
  },
  "two HTML entries": {
    fixture: () => fixtures["configs-two-entries"].path,
    config: {
      build: {
        rollupOptions: {
          input: {
            index: join(fixtures["configs-two-entries"].path, "index.html"),
            other: join(fixtures["configs-two-entries"].path, "other.html"),
          },
        },
      },
    },
    // The same family in two stylesheets is minified once and shares one result: no warning
    check: ([output]) => {
      const cssFiles = output.filter(
        (item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(".css"),
      );
      expect(cssFiles).toHaveLength(2);
      // Both stylesheets point at the same minified files
      const fonts = getFontAssets(output);
      expect(fonts).toHaveLength(2);
      cssFiles.forEach((css) =>
        fonts.forEach((font) => expect(String(css.source)).toContain(font.fileName)),
      );
    },
  },
};

const baseNameOf = (fileName: string): string => fileName.slice(fileName.lastIndexOf("/") + 1);

// Fonts the given outputs point at, by output file name
const referencedFonts = (output: OutputItem[], from: (fileName: string) => boolean) => {
  const names = new Set(
    collectFontReferences(output)
      .filter((ref) => from(ref.from))
      .map((ref) => baseNameOf(ref.path)),
  );
  return getFontAssets(output).filter((asset) => names.has(baseNameOf(asset.fileName)));
};

const expectInvariants = (output: OutputItem[]): void => {
  expect(findBrokenFontReferences(output)).toEqual([]);
  expect(findOrphanFontAssets(output)).toEqual([]);

  // @font-face sources are minified
  const cssFonts = referencedFonts(output, (name) => name.endsWith(".css") || name.endsWith(".js"));
  const minified = cssFonts.filter((asset) => {
    const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
    return Buffer.from(asset.source).length < fontsLength[ext];
  });
  expect(minified.length).toBeGreaterThan(0);

  const readable = getReadableFontAssets(minified);
  expect(readable.length).toBeGreaterThan(0);
  readable.forEach((asset) => {
    const font = openFont(asset.source);
    expect(rendersLigature(font, "close"), asset.fileName).toBe(true);
    expect(rendersLigature(font, "star"), asset.fileName).toBe(false);
  });

  // A JS import without ?subset= is not tied to a font-family: it loads the original file,
  // which no stylesheet points at
  const cssNames = new Set(
    referencedFonts(output, (name) => name.endsWith(".css")).map((asset) => asset.fileName),
  );
  getFontAssets(output)
    .filter((asset) => {
      const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
      return Buffer.from(asset.source).length === fontsLength[ext];
    })
    .forEach((asset) => expect(cssNames.has(asset.fileName), asset.fileName).toBe(false));
};

describe("Build config regressions", () => {
  beforeAll(() => {
    spacesProject = createSpacesProject();
  });

  afterAll(() => {
    rmSync(spacesProject, { recursive: true, force: true });
  });

  Object.entries(scenarios).forEach(([name, scenario]) => {
    it(`should minify fonts and keep references with ${name}`, async () => {
      const { outputs, messages } = await buildFixture({
        fixture: scenario.fixture(),
        pluginOptions: PLUGIN_OPTIONS,
        config: scenario.config,
      });

      const expected = scenario.expectedWarnings ?? [];
      const unexpected = messages.filter(
        (m) =>
          (m.type === "warn" || m.type === "error") && !expected.some((re) => re.test(m.message)),
      );
      expect(unexpected).toEqual([]);
      expected.forEach((re) => {
        expect(messages.filter((m) => m.type === "warn" && re.test(m.message))).toHaveLength(1);
      });

      const items = outputs as OutputItem[][];
      items.forEach(expectInvariants);
      scenario.check?.(items);
    });
  });
});
