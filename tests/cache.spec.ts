import { describe, it, expect, afterEach } from "vitest";
import type { OutputAsset } from "rollup";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginOption, Target } from "../src";
import {
  buildByVersion,
  type ContainerVersion,
  fixturesDir,
  generateId,
  outDir,
  viteBuild,
} from "./utils";

const CACHE_DIR_NAME = ".font-extractor-cache";

interface TempProject {
  root: string;
  cacheDir: string;
  useFont(fileName: string): void;
}

const createTempProject = (): TempProject => {
  const root = join(outDir, `cache-${generateId()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    '<!DOCTYPE html><html><head><link href="index.css" rel="stylesheet"></head></html>',
  );
  writeFileSync(
    join(root, "index.css"),
    '@font-face { font-family: "Font Name"; src: url("./font.woff2") format("woff2"); }',
  );
  return {
    root,
    cacheDir: join(root, "cache"),
    useFont: (fileName) =>
      copyFileSync(join(fixturesDir, "fonts", fileName), join(root, "font.woff2")),
  };
};

const getWoff2 = (output: unknown[]): OutputAsset => {
  const asset = (output as OutputAsset[]).find((item) => item.fileName.endsWith(".woff2"));
  if (!asset) throw new Error("woff2 asset not found in build output");
  return asset;
};

describe.sequential("Disk cache", () => {
  const projects: TempProject[] = [];

  afterEach(() => {
    projects.splice(0).forEach((project) => rmSync(project.root, { recursive: true, force: true }));
  });

  const runCacheTests = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      const build = (project: TempProject, target: Target) => {
        const pluginOptions: PluginOption = {
          type: "manual",
          targets: [target],
          cache: project.cacheDir,
        };
        return buildByVersion(version, { fixture: project.root, pluginOptions });
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

        const entries = readdirSync(join(project.cacheDir, CACHE_DIR_NAME));
        expect(entries).toHaveLength(1);
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runCacheTests(version);
  });
});
