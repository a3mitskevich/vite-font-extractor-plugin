import { describe, it, expect, afterAll } from "vitest";
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginOption, Target } from "../src";
import {
  buildFixture,
  fixtures,
  fixturesDir,
  fontsLength,
  generateId,
  getFontAssets,
  type OutputItem,
  outDir,
} from "./utils";

const root = join(outDir, `strict-${generateId()}`);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const strictBuild = (fixture: string, targets: Target[], options: Partial<PluginOption> = {}) =>
  buildFixture({
    fixture,
    pluginOptions: { type: "manual", targets, cache: false, strict: true, ...options },
  });

const HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Strict</title><link href="index.css" rel="stylesheet"></head></html>`;

// A project with one face of the icon font in the formats given
function createFormatsProject(name: string, sources: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), HTML);
  const urls = Object.keys(sources).map((file) => `url("./${file}")`);
  writeFileSync(
    join(dir, "index.css"),
    `@font-face { font-family: "Icons"; src: ${urls.join(", ")}; }\n`,
  );
  for (const [file, source] of Object.entries(sources)) {
    copyFileSync(join(fixturesDir, "fonts", source), join(dir, file));
  }
  return dir;
}

// The partial of edge-partial-names with fonts: the file of "Text Bold" is written by interpolation
function createPartialNamesProject(): string {
  const dir = join(root, `partial-names-${generateId()}`);
  cpSync(join(fixturesDir, "edge-partial-names"), dir, { recursive: true });
  mkdirSync(join(dir, "fonts"));
  cpSync(join(fixturesDir, "fonts", "text-font.woff2"), join(dir, "fonts", "text.woff2"));
  cpSync(join(fixturesDir, "fonts", "icon-font.woff2"), join(dir, "fonts", "text-bold.woff2"));
  return dir;
}

const ICONS: Target = { fontName: "Font Name", ligatures: ["close"] };

describe("Strict mode", () => {
  it("should build as usual when every target is minified", async () => {
    const { output, messages } = await strictBuild(fixtures.plain.path, [ICONS]);
    expect(messages.filter((m) => m.type === "warn" || m.type === "error")).toEqual([]);
    for (const asset of getFontAssets(output as OutputItem[])) {
      const extension = asset.fileName.split(".").pop() as keyof typeof fontsLength;
      expect(asset.source.length, asset.fileName).toBeLessThan(fontsLength[extension]);
    }
  });

  it("should fail when a target font fails to minify", async () => {
    await expect(
      strictBuild(fixtures.plain.path, [{ fontName: "Font Name", ligatures: ["no_such_icon"] }]),
    ).rejects.toThrow(/Strict mode: Failed to minify "Font Name": /);
  });

  it("should fail when the source of a target face is not found", async () => {
    const project = createPartialNamesProject();
    const target: Target = { fontName: "Text Bold", engine: "subset", characters: "ABC" };
    const failure = strictBuild(project, [target]);
    await expect(failure).rejects.toThrow(
      /Strict mode: Font "Text Bold": the source of .*text-bold.* was not found/,
    );
    await expect(failure).rejects.not.toThrow(/keeping original/);
  });

  it("should only warn for a ?subset= face without a target", async () => {
    const project = createPartialNamesProject();
    const { messages } = await strictBuild(project, []);
    const warnings = messages.filter((m) => m.type === "warn").map((m) => m.message);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Font "Text Bold": the source of .* keeping original/);
  });

  it("should fail when a target face loads from another host", async () => {
    await expect(
      strictBuild(fixtures["font-family-resource-is-url"].path, [ICONS]),
    ).rejects.toThrow(/Strict mode: Font "Font Name" has external url sources/);
  });

  it("should fail when a format of a target face can not be minified", async () => {
    const project = createFormatsProject("otf", {
      "icon-font.otf": "icon-font.ttf",
      "icon-font.woff2": "icon-font.woff2",
    });
    await expect(
      strictBuild(project, [{ fontName: "Icons", ligatures: ["close"] }]),
    ).rejects.toThrow(/Strict mode: Font "Icons": \.otf is not supported for minification$/m);
  });

  it("should fail when a target face has no readable source", async () => {
    const project = createFormatsProject("eot", { "icon-font.eot": "icon-font.eot" });
    await expect(
      strictBuild(project, [{ fontName: "Icons", ligatures: ["close"] }]),
    ).rejects.toThrow(/Strict mode: Font "Icons": \.eot can not be read for minification\./);
  });

  it("should fail when a target matches no face", async () => {
    await expect(
      strictBuild(fixtures.plain.path, [ICONS, { fontName: "Missing", ligatures: ["close"] }]),
    ).rejects.toThrow(/Strict mode: target "Missing" matched no @font-face/);
  });

  it("should count a target matched by a Google Fonts url of HTML", async () => {
    const targets = fixtures["google-font"].fonts.map((font) => ({
      fontName: font.name,
      ligatures: ["close"],
    }));
    const { output } = await strictBuild(fixtures["google-font"].path, targets);
    expect(output.length).toBeGreaterThan(0);
  });
});
