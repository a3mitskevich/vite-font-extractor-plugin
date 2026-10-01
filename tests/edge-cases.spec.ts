import { describe, it, expect } from "vitest";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";
import {
  buildFixture,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fixtures,
  fixturesDir,
  fontsLength,
  generateId,
  getFontAssets,
  getFontFilesByFamily,
  type LoggerMessage,
  outDir,
  type OutputItem,
  plugin,
  textFontsLength,
  toFsUrl,
} from "./utils";

const problems = (messages: LoggerMessage[]) =>
  messages.filter((m) => m.type === "warn" || m.type === "error");

describe("Edge cases", () => {
  it("should not take a font for another one whose name contains it (Roboto / Roboto-Bold)", async () => {
    const root = join(outDir, `edge-names-${generateId()}`);
    cpSync(join(fixturesDir, "edge-partial-names"), root, { recursive: true });
    mkdirSync(join(root, "fonts"));
    cpSync(join(fixturesDir, "fonts", "text-font.woff2"), join(root, "fonts", "text.woff2"));
    // Different bytes behind the interpolated name
    cpSync(join(fixturesDir, "fonts", "icon-font.woff2"), join(root, "fonts", "text-bold.woff2"));
    try {
      const { output, messages } = await buildFixture({
        fixture: root,
        pluginOptions: { type: "manual", targets: [] },
      });
      const items = output as OutputItem[];
      expect(findBrokenFontReferences(items)).toEqual([]);
      // The interpolated path names no candidate: the face keeps its original and says why
      const warnings = problems(messages).map((m) => m.message);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/Font "Text Bold": the source of .*text-bold.* was not found/);
      expect(findOrphanFontAssets(items)).toEqual([]);

      const byFamily = getFontFilesByFamily(items);
      const [text] = byFamily.get("Text")!;
      const [bold] = byFamily.get("Text Bold")!;
      expect(bold).not.toBe(text);
      // The bold face keeps its own file: the minified text font is smaller than both
      const sizeOf = (fileName: string) =>
        getFontAssets(items).find((asset) => asset.fileName === fileName)!.source.length;
      expect(sizeOf(text)).toBeLessThan(textFontsLength.woff2);
      expect(sizeOf(bold)).toBeGreaterThan(sizeOf(text));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("should keep a plain url of a ?subset= face original without an error", async () => {
    const { output, messages } = await buildFixture({
      fixture: join(fixturesDir, "edge-mixed-subset"),
      pluginOptions: { type: "manual", targets: [] },
    });
    const items = output as OutputItem[];

    expect(problems(messages)).toEqual([]);
    const fonts = getFontAssets(items);
    const woff2 = fonts.find((asset) => asset.fileName.endsWith(".woff2"))!;
    const woff = fonts.find((asset) => asset.fileName.endsWith(".woff"))!;
    expect(woff2.source.length).toBeLessThan(textFontsLength.woff2);
    expect(woff.source.length).toBe(textFontsLength.woff);
  });

  it("should report the interpolated url of a face that also has a static one", async () => {
    const { output, messages } = await buildFixture({
      fixture: join(fixturesDir, "edge-mixed-interpolation"),
      targets: ["Material Icons"],
    });
    const items = output as OutputItem[];

    expect(findBrokenFontReferences(items)).toEqual([]);
    expect(findOrphanFontAssets(items)).toEqual([]);
    const fonts = getFontAssets(items);
    const woff2 = fonts.find((asset) => asset.fileName.endsWith(".woff2"))!;
    const woff = fonts.find((asset) => asset.fileName.endsWith(".woff"))!;
    expect(woff2.source.length).toBeLessThan(fontsLength.woff2);
    // No candidate names the interpolated path: the original stays and a warning says why
    expect(woff.source.length).toBe(fontsLength.woff);
    const warnings = problems(messages).map((m) => m.message);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /Font "Material Icons": the source of .*icon-font.*\.woff was not found/,
    );
  });

  it("should not emit a font for a face of a mixin that is never included", async () => {
    const { output, messages } = await buildFixture({
      fixture: join(fixturesDir, "edge-unused-mixin"),
      targets: ["Material Icons"],
    });
    const items = output as OutputItem[];

    expect(problems(messages)).toEqual([]);
    expect(getFontAssets(items)).toEqual([]);
  });

  it("should not serve a font outside server.fs.allow in dev", async () => {
    const root = join(outDir, `edge-fs-${generateId()}`);
    const outside = join(outDir, `edge-outside-${generateId()}`);
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    cpSync(join(fixturesDir, "fonts", "text-font.woff2"), join(outside, "secret.woff2"));
    const server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [await plugin({ type: "manual", targets: [], cache: false })],
      server: { port: 0, strictPort: false, hmr: false, fs: { allow: [root] } },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      const port = typeof address === "object" && address ? address.port : 5173;
      const outsideName = outside.slice(outDir.length + 1);
      for (const path of [
        `${toFsUrl(join(outside, "secret.woff2"))}?subset=ABC`,
        `/%2e%2e/${outsideName}/secret.woff2?subset=ABC`,
      ]) {
        const response = await fetch(`http://localhost:${port}${path}`);
        const body = Buffer.from(await response.arrayBuffer());
        // Vite denies it; the plugin never answers with a minified font
        expect(body.length, path).toBeLessThan(1000);
      }
    } finally {
      await server.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("Disk cache: client and SSR builds of one config", () => {
  it("should keep the client's entries after the SSR build and leave no temporary files", async () => {
    const root = join(outDir, `edge-cache-${generateId()}`);
    cpSync(fixtures.plain.path, root, { recursive: true });
    // Rebase the font urls of the copy onto the shared fonts
    cpSync(join(fixturesDir, "fonts"), join(outDir, "fonts"), { recursive: true });
    // The server entry loads no fonts
    writeFileSync(join(root, "server.js"), "export const render = () => 'ok';\n");
    const cache = join(root, "cache");
    const pluginOptions = {
      type: "manual" as const,
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
      cache,
    };
    const config = { build: { outDir: join(root, "dist") } };
    const entries = (): string[] =>
      readdirSync(join(cache, ".font-extractor-cache"), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    try {
      await buildFixture({ fixture: root, pluginOptions, config });
      const afterClient = entries();
      expect(afterClient.length).toBeGreaterThan(0);

      await buildFixture({ fixture: root, pluginOptions, config, ssr: "server.js" });
      expect(entries()).toEqual(expect.arrayContaining(afterClient));
      expect(entries().some((name) => name.endsWith(".tmp"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Hooks without filters", () => {
  // moduleParsed runs for every module of the build: only auto mode needs it
  it("should register moduleParsed in auto mode only", async () => {
    const hasModuleParsed = async (options: Parameters<typeof plugin>[0]) =>
      (await plugin(options)).some((part) => "moduleParsed" in part);

    expect(await hasModuleParsed({ type: "manual", targets: [] })).toBe(false);
    expect(await hasModuleParsed({ type: "auto" })).toBe(true);
  });

  it("should give every per-module hook a filter", async () => {
    const parts = await plugin({ type: "auto" });
    for (const part of parts) {
      for (const hook of ["resolveId", "load", "transform"] as const) {
        const value = part[hook];
        if (!value) continue;
        expect(typeof value === "object" && "filter" in value, `${part.name} ${hook}`).toBe(true);
      }
    }
  });
});
