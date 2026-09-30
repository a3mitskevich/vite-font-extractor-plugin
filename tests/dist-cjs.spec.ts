import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { FontExtractorPlugin } from "../src";
import {
  buildByVersion,
  dir,
  findBrokenFontReferences,
  fixtures,
  fontsLength,
  getFontAssets,
  getReadableFontAssets,
  openFont,
  type OutputItem,
  rendersLigature,
  viteBuild,
} from "./utils";

const PACKAGE_NAME = "vite-font-extractor-plugin";
const DIST_CJS = join(dir, "..", "dist", "index.cjs");

interface CjsModule {
  default: FontExtractorPlugin;
  FontExtractor: FontExtractorPlugin;
}

const require = createRequire(import.meta.url);

// Needs `npm run build`; skipped when dist/ is absent like the rest of `test:dist`
describe.skipIf(!existsSync(DIST_CJS))("dist: CommonJS build", () => {
  const loadCjs = (): CjsModule => require(PACKAGE_NAME) as CjsModule;

  it("should resolve require() of the package to dist/index.cjs", () => {
    expect(require.resolve(PACKAGE_NAME)).toBe(DIST_CJS);
  });

  it("should expose the plugin as .default and .FontExtractor", () => {
    const cjs = loadCjs();
    expect(typeof cjs.default).toBe("function");
    expect(cjs.FontExtractor).toBe(cjs.default);
    expect(cjs.default({ type: "manual", targets: [] }).name).toBe(PACKAGE_NAME);
  });

  // Oldest and newest supported Vite
  Object.keys(viteBuild)
    .filter((version) => /^[58]\./.test(version))
    .forEach((version) => {
      it(`should minify fonts in a vite@${version} build`, async () => {
        const { output, messages } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          pluginFactory: loadCjs().default,
          pluginOptions: {
            type: "manual",
            targets: [{ fontName: "Font Name", ligatures: ["close"] }],
            cache: false,
          },
        });
        const items = output as OutputItem[];

        expect(messages.filter((m) => m.type === "warn" || m.type === "error")).toEqual([]);
        expect(findBrokenFontReferences(items)).toEqual([]);
        const fonts = getFontAssets(items);
        expect(fonts).toHaveLength(4);
        fonts.forEach((asset) => {
          const ext = asset.fileName.split(".").pop() as keyof typeof fontsLength;
          expect(Buffer.from(asset.source).length, asset.fileName).toBeLessThan(fontsLength[ext]);
        });
        getReadableFontAssets(items).forEach((asset) => {
          expect(rendersLigature(openFont(asset.source), "close"), asset.fileName).toBe(true);
        });
      });
    });
});
