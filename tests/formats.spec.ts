import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { OutputAsset, RollupOutput } from "rollup";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "fontkit";
import {
  buildByVersion,
  findBrokenFontReferences,
  fixturesDir,
  fontsLength,
  generateId,
  type LoggerMessage,
  outDir,
  viteBuild,
} from "./utils";

type Output = RollupOutput["output"];

const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Formats</title><link href="index.css" rel="stylesheet"></head></html>`;

const face = (sources: string): string =>
  `@font-face { font-family: "Icons"; src: ${sources}; }\n.icon { font-family: "Icons"; }\n`;

// Fixtures are generated: an .otf is the TTF fixture under another name (fontext reads it,
// but can not write otf), kept out of the repository
const PROJECTS = {
  otfWithWoff2: face(
    `url("./icon-font.otf") format("opentype"), url("./icon-font.woff2") format("woff2")`,
  ),
  otfOnly: face(`url("./icon-font.otf") format("opentype")`),
  eotOnly: face(`url("./icon-font.eot")`),
};

const root = join(outDir, `formats-${generateId()}`);

const createProject = (name: string, css: string): string => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), HTML);
  writeFileSync(join(dir, "index.css"), css);
  const fonts = join(fixturesDir, "fonts");
  copyFileSync(join(fonts, "icon-font.ttf"), join(dir, "icon-font.otf"));
  copyFileSync(join(fonts, "icon-font.woff2"), join(dir, "icon-font.woff2"));
  copyFileSync(join(fonts, "icon-font.eot"), join(dir, "icon-font.eot"));
  return dir;
};

beforeAll(() => {
  for (const [name, css] of Object.entries(PROJECTS)) createProject(name, css);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const build = (version: string, project: keyof typeof PROJECTS) =>
  buildByVersion(version, {
    fixture: join(root, project),
    pluginOptions: {
      type: "manual",
      targets: [{ fontName: "Icons", ligatures: ["close"] }],
      cache: false,
    },
  });

const getFont = (output: Output, ext: string): OutputAsset => {
  const asset = output.find(
    (item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(`.${ext}`),
  );
  expect(asset, `.${ext} in output`).toBeDefined();
  return asset!;
};

const expectSingleWarning = (messages: LoggerMessage[], ...parts: string[]): void => {
  expect(messages.filter(({ type }) => type === "error")).toEqual([]);
  const warnings = messages.filter(({ type }) => type === "warn");
  expect(warnings).toHaveLength(1);
  for (const part of parts) expect(warnings[0].message).toContain(part);
};

describe("Font formats without minification support", () => {
  Object.keys(viteBuild).forEach((version) => {
    describe(`vite@${version}`, () => {
      it("keeps .otf and minifies the other formats of the face", async () => {
        const { output, messages } = await build(version, "otfWithWoff2");

        expectSingleWarning(messages, "otf", "keeping original");
        expect(findBrokenFontReferences(output)).toEqual([]);
        expect(Buffer.from(getFont(output, "otf").source).length).toBe(fontsLength.ttf);
        const woff2 = Buffer.from(getFont(output, "woff2").source);
        expect(woff2.length).toBeLessThan(fontsLength.woff2);
        const glyphs = (fontkit.create(woff2) as fontkit.Font).layout("close").glyphs;
        expect(glyphs).toHaveLength(1);
        expect(glyphs[0].id).not.toBe(0);
      });

      it("keeps a face with .otf only", async () => {
        const { output, messages } = await build(version, "otfOnly");

        expectSingleWarning(messages, "otf", "keeping original");
        expect(Buffer.from(getFont(output, "otf").source).length).toBe(fontsLength.ttf);
      });

      it("keeps a face with .eot only", async () => {
        const { output, messages } = await build(version, "eotOnly");

        expectSingleWarning(messages, "eot", "keeping original");
        expect(Buffer.from(getFont(output, "eot").source).length).toBe(fontsLength.eot);
      });
    });
  });
});
