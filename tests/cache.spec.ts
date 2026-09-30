import { describe, it, expect, afterEach } from "vitest";
import type { OutputAsset } from "./utils";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "vite";
import { join } from "node:path";
import type { PluginOption, Target } from "../src";
import { buildFixture, fixturesDir, fontsLength, generateId, outDir, plugin } from "./utils";

const CACHE_DIR_NAME = ".font-extractor-cache";
// The dev server writes its cache usage one second after the last minification
const DEV_USAGE_SETTLE_MS = 1500;

interface TempProject {
  root: string;
  cacheDir: string;
  useFont(fileName: string): void;
}

const createTempProject = (family = "Font Name"): TempProject => {
  const root = join(outDir, `cache-${generateId()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    '<!DOCTYPE html><html><head><link href="index.css" rel="stylesheet"></head></html>',
  );
  writeFileSync(
    join(root, "index.css"),
    `@font-face { font-family: "${family}"; src: url("./font.woff2") format("woff2"); }`,
  );
  return {
    root,
    cacheDir: join(root, "cache"),
    useFont: (fileName) =>
      copyFileSync(join(fixturesDir, "fonts", fileName), join(root, "font.woff2")),
  };
};

// Cached fonts; `.usage` holds the keys each build or dev server used
const cacheEntries = (parent: string): string[] =>
  readdirSync(join(parent, CACHE_DIR_NAME), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

const getWoff2 = (output: unknown[]): OutputAsset => {
  const asset = (output as OutputAsset[]).find((item) => item.fileName.endsWith(".woff2"));
  if (!asset) throw new Error("woff2 asset not found in build output");
  return asset;
};

describe("Disk cache", () => {
  const projects: TempProject[] = [];

  afterEach(() => {
    projects.splice(0).forEach((project) => rmSync(project.root, { recursive: true, force: true }));
  });

  const build = (project: TempProject, target: Target) => {
    const pluginOptions: PluginOption = {
      type: "manual",
      targets: [target],
      cache: project.cacheDir,
    };
    // One config, one output directory: every build is the same cache owner
    return buildFixture({
      fixture: project.root,
      pluginOptions,
      config: { build: { outDir: join(project.root, "dist") } },
    });
  };

  it("should not reuse a cached result after the source font changes", async () => {
    const project = createTempProject();
    projects.push(project);
    const target: Target = { fontName: "Font Name", engine: "subset", characters: "abc" };

    project.useFont("text-font.woff2");
    const first = getWoff2((await build(project, target)).output);
    project.useFont("icon-font.woff2");
    const second = getWoff2((await build(project, target)).output);

    expect(Buffer.from(second.source).equals(Buffer.from(first.source))).toBe(false);
  });

  it("should drop cache entries that are no longer used", async () => {
    const project = createTempProject();
    projects.push(project);
    project.useFont("icon-font.woff2");

    await build(project, { fontName: "Font Name", ligatures: ["close"] });
    await build(project, { fontName: "Font Name", ligatures: ["play_arrow"] });

    expect(cacheEntries(project.cacheDir)).toHaveLength(1);
  });

  it("should cache a font whose family name contains path characters", async () => {
    const family = "Icons/../Regular";
    const project = createTempProject(family);
    projects.push(project);
    project.useFont("icon-font.woff2");

    const { output, messages } = await build(project, {
      fontName: family,
      ligatures: ["close"],
    });

    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    expect(Buffer.from(getWoff2(output).source).length).toBeLessThan(fontsLength.woff2);
    expect(cacheEntries(project.cacheDir)).toHaveLength(1);
  });

  it("should keep the cache in Vite's cache directory by default", async () => {
    const project = createTempProject();
    projects.push(project);
    project.useFont("icon-font.woff2");
    const viteCacheDir = join(project.root, "vite-cache");

    await buildFixture({
      fixture: project.root,
      pluginOptions: {
        type: "manual",
        targets: [{ fontName: "Font Name", ligatures: ["close"] }],
        cache: true,
      },
      config: { cacheDir: viteCacheDir },
    });

    expect(cacheEntries(viteCacheDir)).toHaveLength(1);
  });

  it("should keep the entries of another config that shares the project root", async () => {
    const project = createTempProject();
    projects.push(project);
    project.useFont("icon-font.woff2");
    const buildTo = (outDirName: string, ligature: string) =>
      buildFixture({
        fixture: project.root,
        pluginOptions: {
          type: "manual",
          targets: [{ fontName: "Font Name", ligatures: [ligature] }],
          cache: project.cacheDir,
        },
        config: { build: { outDir: join(project.root, outDirName) } },
      });

    await buildTo("dist-a", "close");
    await buildTo("dist-b", "play_arrow");
    expect(cacheEntries(project.cacheDir)).toHaveLength(2);

    // A build prunes only what no config used lately: the entry of dist-a's old glyphs goes
    await buildTo("dist-a", "star");
    expect(cacheEntries(project.cacheDir)).toHaveLength(2);
  });

  it("should keep the entries of a dev server when building", async () => {
    const project = createTempProject();
    projects.push(project);
    project.useFont("icon-font.woff2");
    const pluginOptions = (ligature: string): PluginOption => ({
      type: "manual",
      targets: [{ fontName: "Font Name", ligatures: [ligature] }],
      cache: project.cacheDir,
    });

    const server = await createServer({
      root: project.root,
      configFile: false,
      logLevel: "silent",
      plugins: [await plugin(pluginOptions("close"))],
      server: { port: 0, strictPort: false, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      const origin = `http://localhost:${typeof address === "object" && address ? address.port : 5173}`;
      const css = await (
        await fetch(`${origin}/index.css`, { headers: { accept: "text/css" } })
      ).text();
      const url = /url\(["']?([^"')]+)["']?\)/.exec(css)?.[1];
      await fetch(`${origin}${url}`);
      // The dev server records the keys it used once minification settles
      await new Promise((resolve) => {
        setTimeout(resolve, DEV_USAGE_SETTLE_MS);
      });
    } finally {
      await server.close();
    }
    expect(cacheEntries(project.cacheDir)).toHaveLength(1);

    await buildFixture({ fixture: project.root, pluginOptions: pluginOptions("play_arrow") });
    expect(cacheEntries(project.cacheDir)).toHaveLength(2);
  });

  it("should remove the default and the 3.x cache directories when cache is disabled", async () => {
    const project = createTempProject();
    projects.push(project);
    project.useFont("icon-font.woff2");
    const viteCacheDir = join(project.root, "vite-cache");
    const defaultCache = join(viteCacheDir, CACHE_DIR_NAME);
    const legacyCache = join(project.root, "node_modules", CACHE_DIR_NAME);
    mkdirSync(defaultCache, { recursive: true });
    mkdirSync(legacyCache, { recursive: true });

    await buildFixture({
      fixture: project.root,
      pluginOptions: {
        type: "manual",
        targets: [{ fontName: "Font Name", ligatures: ["close"] }],
        cache: false,
      },
      config: { cacheDir: viteCacheDir },
    });

    expect(existsSync(defaultCache)).toBe(false);
    expect(existsSync(legacyCache)).toBe(false);
  });
});
