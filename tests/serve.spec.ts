import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import type * as fontkit from "fontkit";
import { dirname, join } from "node:path";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { PluginOption } from "../src";
import {
  plugin,
  createFakeLogger,
  fixturesDir,
  openFont,
  rendersLigature,
  fixtures,
  fontsLength,
  createFixture,
  generateId,
  type LoggerMessage,
  outDir,
  toFsUrl,
} from "./utils";

const devFixtures = {
  textFont: createFixture("dev-text-font"),
  autoTwoCss: createFixture("dev-auto-two-css"),
  fontQuery: createFixture("dev-font-query"),
  serveFollow: createFixture("dev-serve-follow"),
  googleAuto: createFixture("dev-google-auto"),
};

const CLOSE_CODE_POINT = 0xe5cd;
const PLAY_ARROW_CODE_POINT = 0xe037;
const textFontSource = readFileSync(join(fixturesDir, "fonts", "text-font.woff2"));

interface DevSession {
  origin: string;
  messages: LoggerMessage[];
}

async function withDevServer(
  root: string,
  pluginOptions: PluginOption | undefined,
  run: (session: DevSession) => Promise<void>,
): Promise<void> {
  const logger = createFakeLogger();
  const { messages } = logger;
  const FontExtract = pluginOptions ? await plugin(pluginOptions) : await plugin();
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    customLogger: logger,
    plugins: [FontExtract],
    server: { port: 0, strictPort: false, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 5173;
    await run({ origin: `http://localhost:${port}`, messages });
  } finally {
    await server.close();
  }
}

const fetchCss = async (origin: string, path: string): Promise<string> =>
  (await fetch(`${origin}${path}`, { headers: { accept: "text/css" } })).text();

const fontUrlsOf = (css: string): string[] =>
  Array.from(css.matchAll(/url\(["']?([^"')]+)["']?\)/g), (match) => match[1]);

const fetchFont = async (
  origin: string,
  url: string,
): Promise<{ status: number; body: Buffer }> => {
  const response = await fetch(`${origin}${url}`);
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
};

const problemsOf = (messages: LoggerMessage[]): LoggerMessage[] =>
  messages.filter((m) => m.type === "warn" || m.type === "error");

const flushRejections = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 100);
  });

describe("Dev server", () => {
  let server: ViteDevServer;
  let baseUrl: string;
  const logger = createFakeLogger();
  const logMessages = logger.messages;

  beforeAll(async () => {
    const FontExtract = await plugin({
      type: "manual",
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
    });

    server = await createServer({
      root: join(fixturesDir, "plain"),
      configFile: false,
      logLevel: "silent",
      customLogger: logger,
      plugins: [FontExtract],
      server: { port: 0, strictPort: false },
    });

    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 5173;
    baseUrl = `http://localhost:${port}`;

    // Trigger CSS transform to populate fontServeProxy
    await server.transformRequest("plain.css");
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  it("should serve minified fonts via middleware", async () => {
    // In dev mode, font URLs are served relative to root
    const fontPath = join(fixturesDir, "fonts", "icon-font.woff2");
    const originalSize = readFileSync(fontPath).length;

    // Request font through Vite's /@fs/ prefix
    const response = await fetch(`${baseUrl}${toFsUrl(fontPath)}`);
    expect(response.ok).toBeTruthy();

    const body = await response.arrayBuffer();
    // Font should be minified (smaller than original)
    expect(body.byteLength).toBeLessThan(originalSize);
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it("should serve every font format minified", async () => {
    for (const ext of ["woff2", "woff", "ttf", "eot"] as const) {
      const fontPath = join(fixturesDir, "fonts", `icon-font.${ext}`);
      const { status, body } = await fetchFont(baseUrl, toFsUrl(fontPath));
      expect(status).toBe(200);
      expect(body.byteLength).toBeGreaterThan(0);
      expect(body.byteLength).toBeLessThan(fontsLength[ext]);
      // fontkit cannot read EOT
      if (ext !== "eot") {
        expect(rendersLigature(openFont(body), "close")).toBe(true);
      }
    }
  });

  it("should send a minified font with its content type and an etag", async () => {
    const contentTypes = { woff2: "font/woff2", eot: "application/vnd.ms-fontobject" };
    for (const [ext, contentType] of Object.entries(contentTypes)) {
      const url = `${baseUrl}${toFsUrl(join(fixturesDir, "fonts", `icon-font.${ext}`))}`;
      const response = await fetch(url);
      await response.arrayBuffer();
      expect(response.headers.get("content-type"), ext).toBe(contentType);
      const etag = response.headers.get("etag");
      expect(etag, ext).toBeTruthy();

      const revalidated = await fetch(url, { headers: { "if-none-match": etag! } });
      expect(revalidated.status, ext).toBe(304);
    }
  });

  it("should not intercept non-font requests", async () => {
    const response = await fetch(`${baseUrl}/plain.css`);
    // CSS is served by Vite itself, not our font middleware
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).not.toContain("font/");
  });

  it("should log plugin start in serve mode", () => {
    const hasPluginStart = logMessages.some(
      (m) => m.type === "info" && m.message.includes("vite-font-extractor-plugin"),
    );
    expect(hasPluginStart).toBeTruthy();
  });

  it("should cache minification result between requests", async () => {
    const fontPath = join(fixturesDir, "fonts", "icon-font.woff2");

    const response1 = await fetch(`${baseUrl}${toFsUrl(fontPath)}`);
    const body1 = await response1.arrayBuffer();

    const response2 = await fetch(`${baseUrl}${toFsUrl(fontPath)}`);
    const body2 = await response2.arrayBuffer();

    // Same size = cached result reused
    expect(body1.byteLength).toBe(body2.byteLength);
  });
});

describe("Dev server: minification errors", () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };

  beforeAll(() => {
    process.on("unhandledRejection", onRejection);
  });

  afterAll(() => {
    process.off("unhandledRejection", onRejection);
  });

  it(`should serve the original font and keep running when minification fails`, async () => {
    rejections.length = 0;
    // `characters` needs `engine: "subset"` — fontext rejects this target
    const options: PluginOption = {
      type: "manual",
      cache: false,
      targets: [{ fontName: "Text Font", characters: "abc" }],
    };
    await withDevServer(devFixtures.textFont.path, options, async (dev) => {
      const [url] = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));

      const first = await fetchFont(dev.origin, url);
      await flushRejections();
      expect(rejections).toEqual([]);
      expect(first.status).toBe(200);
      expect(first.body.equals(textFontSource)).toBe(true);

      const errors = dev.messages.filter((m) => m.type === "error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain("Text Font");
      expect(errors[0].message).toContain("At least one of");

      const second = await fetchFont(dev.origin, url);
      await flushRejections();
      expect(rejections).toEqual([]);
      expect(second.status).toBe(200);
      expect(second.body.equals(textFontSource)).toBe(true);
    });
  });

  it(`should minify again once a broken font file is fixed`, async () => {
    const workDir = join(outDir, `dev-retry-${generateId()}`);
    const root = join(workDir, "project");
    const fontPath = join(workDir, "fonts", "text-font.woff2");
    cpSync(devFixtures.textFont.path, root, { recursive: true });
    mkdirSync(dirname(fontPath), { recursive: true });
    cpSync(join(fixturesDir, "log-levels", "broken.woff2"), fontPath);
    const options: PluginOption = {
      type: "manual",
      cache: false,
      targets: [{ fontName: "Text Font", engine: "subset", characters: "abc" }],
    };
    try {
      await withDevServer(root, options, async (dev) => {
        const [url] = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));
        expect((await fetchFont(dev.origin, url)).status).toBe(200);
        expect(dev.messages.filter((m) => m.type === "error").length).toBeGreaterThan(0);

        cpSync(join(fixturesDir, "fonts", "text-font.woff2"), fontPath);
        const { status, body } = await fetchFont(dev.origin, url);
        expect(status).toBe(200);
        expect(body.byteLength).toBeLessThan(textFontSource.byteLength);
        expect(openFont(body).hasGlyphForCodePoint("a".codePointAt(0)!)).toBe(true);
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it(`should serve the original font in auto mode before any glyph is found`, async () => {
    rejections.length = 0;
    await withDevServer(devFixtures.textFont.path, undefined, async (dev) => {
      const [url] = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));

      const { status, body } = await fetchFont(dev.origin, url);
      await flushRejections();
      expect(rejections).toEqual([]);
      expect(status).toBe(200);
      expect(body.equals(textFontSource)).toBe(true);
      expect(dev.messages.filter((m) => m.type === "error")).toEqual([]);
    });
  });
});

describe("Dev server: options", () => {
  it(`should minify a manual target`, async () => {
    const options: PluginOption = {
      type: "manual",
      cache: false,
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
    };
    await withDevServer(fixtures.plain.path, options, async (dev) => {
      const urls = fontUrlsOf(await fetchCss(dev.origin, "/plain.css"));
      const woff2 = urls.find((url) => url.includes(".woff2"))!;

      const { status, body } = await fetchFont(dev.origin, woff2);
      expect(status).toBe(200);
      expect(body.byteLength).toBeLessThan(fontsLength.woff2);
      expect(rendersLigature(openFont(body), "close")).toBe(true);
      expect(problemsOf(dev.messages)).toEqual([]);
    });
  });

  it(`should collect auto glyphs from several CSS files`, async () => {
    const options: PluginOption = { type: "auto", cache: false };
    await withDevServer(devFixtures.autoTwoCss.path, options, async (dev) => {
      const [url] = fontUrlsOf(await fetchCss(dev.origin, "/font.css"));

      const before = openFont((await fetchFont(dev.origin, url)).body);
      expect(before.hasGlyphForCodePoint(CLOSE_CODE_POINT)).toBe(true);
      expect(before.hasGlyphForCodePoint(PLAY_ARROW_CODE_POINT)).toBe(false);

      await fetchCss(dev.origin, "/icons.css");
      const { status, body } = await fetchFont(dev.origin, url);
      expect(status).toBe(200);
      expect(body.byteLength).toBeLessThan(fontsLength.woff2);
      const after = openFont(body);
      expect(after.hasGlyphForCodePoint(CLOSE_CODE_POINT)).toBe(true);
      expect(after.hasGlyphForCodePoint(PLAY_ARROW_CODE_POINT)).toBe(true);
      expect(dev.messages.filter((m) => m.type === "error")).toEqual([]);
    });
  });

  it(`should minify a font whose url carries ?v=`, async () => {
    const options: PluginOption = {
      type: "manual",
      cache: false,
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
    };
    await withDevServer(devFixtures.fontQuery.path, options, async (dev) => {
      const urls = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));
      expect(urls.every((url) => url.includes("v=4.7.0"))).toBe(true);

      for (const url of urls) {
        const ext = url.includes(".woff2") ? "woff2" : "woff";
        const { status, body } = await fetchFont(dev.origin, url);
        expect(status).toBe(200);
        expect(body.byteLength).toBeLessThan(fontsLength[ext]);
        expect(rendersLigature(openFont(body), "close")).toBe(true);
      }
      expect(problemsOf(dev.messages)).toEqual([]);
    });
  });

  it(`should minify a ?subset= face without a target like build`, async () => {
    const options: PluginOption = { type: "manual", cache: false, targets: [] };
    await withDevServer(fixtures["subset-chars"].path, options, async (dev) => {
      const urls = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));
      const woff2 = urls.find((url) => url.includes(".woff2"))!;

      const { status, body } = await fetchFont(dev.origin, woff2);
      expect(status).toBe(200);
      expect(body.byteLength).toBeLessThan(textFontSource.byteLength);
      const font = openFont(body);
      for (const char of "ABC") {
        expect(font.hasGlyphForCodePoint(char.codePointAt(0)!), char).toBe(true);
      }
      expect(font.hasGlyphForCodePoint("q".codePointAt(0)!)).toBe(false);
      expect(problemsOf(dev.messages)).toEqual([]);
    });
  });

  it(`should minify a ?subset= face in auto mode like build`, async () => {
    const options: PluginOption = { type: "auto", cache: false };
    await withDevServer(fixtures["subset-chars"].path, options, async (dev) => {
      const urls = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));
      const woff2 = urls.find((url) => url.includes(".woff2"))!;

      const { status, body } = await fetchFont(dev.origin, woff2);
      expect(status).toBe(200);
      expect(body.byteLength).toBeLessThan(textFontSource.byteLength);
      const font = openFont(body);
      for (const char of "ABC") {
        expect(font.hasGlyphForCodePoint(char.codePointAt(0)!), char).toBe(true);
      }
      expect(font.hasGlyphForCodePoint("q".codePointAt(0)!)).toBe(false);
      expect(problemsOf(dev.messages)).toEqual([]);
    });
  });

  it(`should merge ?subset= in CSS with the target like build`, async () => {
    const options: PluginOption = {
      type: "manual",
      cache: false,
      targets: [{ fontName: "Text Font", engine: "subset", characters: "xyz" }],
    };
    await withDevServer(fixtures["subset-chars"].path, options, async (dev) => {
      const urls = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));
      const woff2 = urls.find((url) => url.includes(".woff2"))!;
      expect(woff2).toContain("subset=ABC");

      const { status, body } = await fetchFont(dev.origin, woff2);
      expect(status).toBe(200);
      expect(body.byteLength).toBeLessThan(textFontSource.byteLength);
      const font = openFont(body);
      for (const char of "ABCxyz") {
        expect(font.hasGlyphForCodePoint(char.codePointAt(0)!), char).toBe(true);
      }
      expect(font.hasGlyphForCodePoint("q".codePointAt(0)!)).toBe(false);
      expect(problemsOf(dev.messages)).toEqual([]);
    });
  });
});

describe("Dev server: generated projects", () => {
  const MANUAL_OPTIONS: PluginOption = {
    type: "manual",
    cache: false,
    targets: [{ fontName: "Font Name", ligatures: ["close"] }],
  };
  const SVG_PADDING = 5000;
  const roots: string[] = [];

  afterAll(() => {
    roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  // A project with the icon font next to index.css and `src` as the @font-face sources
  const createProject = (src: string): string => {
    const root = join(outDir, `dev-project-${generateId()}`);
    roots.push(root);
    mkdirSync(root, { recursive: true });
    cpSync(join(fixturesDir, "fonts", "icon-font.woff2"), join(root, "icon-font.woff2"));
    // Over Vite's inline limit, so the dev server requests it
    writeFileSync(
      join(root, "icon-font.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg"><!--${"-".repeat(SVG_PADDING)}--></svg>`,
    );
    writeFileSync(
      join(root, "index.html"),
      '<!doctype html><html><head><link href="index.css" rel="stylesheet" /></head></html>',
    );
    writeFileSync(join(root, "index.css"), `@font-face { font-family: "Font Name"; src: ${src}; }`);
    return root;
  };

  it("should send a minified SVG font as image/svg+xml", async () => {
    const root = createProject(
      'url("./icon-font.woff2") format("woff2"), url("./icon-font.svg") format("svg")',
    );
    await withDevServer(root, MANUAL_OPTIONS, async (dev) => {
      const urls = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));
      const svg = urls.find((url) => url.includes(".svg"))!;

      const response = await fetch(`${dev.origin}${svg}`);
      const body = await response.text();
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("etag")).toBeTruthy();
      expect(body).toContain("<font");
      expect(problemsOf(dev.messages)).toEqual([]);
    });
  });

  it("should keep `$&` in a font url as text", async () => {
    const root = createProject('url("./icon-font.woff2?v=$&") format("woff2")');
    await withDevServer(root, MANUAL_OPTIONS, async (dev) => {
      const css = await fetchCss(dev.origin, "/index.css");
      expect(css.match(/@font-face/g)).toHaveLength(1);
      const [url] = fontUrlsOf(css);
      expect(url).toContain("?v=$&");

      const { status, body } = await fetchFont(dev.origin, url);
      expect(status).toBe(200);
      expect(body.byteLength).toBeLessThan(fontsLength.woff2);
      expect(rendersLigature(openFont(body), "close")).toBe(true);
    });
  });
});

describe("Dev server: choosing fonts like build", () => {
  const ICONS = { ligatures: ["close"] };
  // The woff2 of plain.css as the dev server answers it
  const fetchWoff2 = async (options: PluginOption) => {
    let result: { body: Buffer; messages: LoggerMessage[] } | undefined;
    await withDevServer(fixtures.plain.path, { cache: false, ...options }, async (dev) => {
      const urls = fontUrlsOf(await fetchCss(dev.origin, "/plain.css"));
      const { status, body } = await fetchFont(
        dev.origin,
        urls.find((url) => url.includes(".woff2"))!,
      );
      expect(status).toBe(200);
      result = { body, messages: dev.messages };
    });
    return result!;
  };

  it(`should minify a face a target matches by RegExp`, async () => {
    const { body, messages } = await fetchWoff2({
      type: "manual",
      targets: [{ fontName: "Icons", match: /^font name$/i, ...ICONS }],
    });
    expect(body.byteLength).toBeLessThan(fontsLength.woff2);
    expect(rendersLigature(openFont(body), "close")).toBe(true);
    expect(problemsOf(messages)).toEqual([]);
  });

  it(`should serve the original of a face an ignore RegExp matches`, async () => {
    const { body } = await fetchWoff2({
      type: "manual",
      targets: [{ fontName: "Font Name", ...ICONS }],
      ignore: [/^Font/],
    });
    expect(body.byteLength).toBe(fontsLength.woff2);
  });

  it(`should minify with the target resolveTarget returns`, async () => {
    const { body } = await fetchWoff2({
      type: "manual",
      targets: [],
      resolveTarget: (face) => ({ fontName: face.family, ...ICONS }),
    });
    expect(body.byteLength).toBeLessThan(fontsLength.woff2);
    expect(rendersLigature(openFont(body), "close")).toBe(true);
  });

  it(`should serve the original when resolveTarget returns null`, async () => {
    const { body } = await fetchWoff2({
      type: "manual",
      targets: [{ fontName: "Font Name", ...ICONS }],
      resolveTarget: () => null,
    });
    expect(body.byteLength).toBe(fontsLength.woff2);
  });

  it(`should keep serving when resolveTarget throws`, async () => {
    const { body, messages } = await fetchWoff2({
      type: "manual",
      targets: [{ fontName: "Font Name", ...ICONS }],
      resolveTarget: () => {
        throw new Error("broken resolver");
      },
    });
    expect(body.byteLength).toBe(fontsLength.woff2);
    expect(messages.some((m) => m.type === "error" && m.message.includes("broken resolver"))).toBe(
      true,
    );
  });
});

describe("Dev server: file shared by families with different options", () => {
  it(`should serve each family its own minified font`, async () => {
    const options: PluginOption = {
      type: "manual",
      cache: false,
      targets: [
        { fontName: "Icons A", ligatures: ["close"] },
        { fontName: "Icons B", ligatures: ["star"] },
      ],
    };
    await withDevServer(fixtures["shared-file-families"].path, options, async (dev) => {
      const css = await fetchCss(dev.origin, "/index.css");
      const urlByFamily = new Map(
        Array.from(css.matchAll(/@font-face\s*\{[^}]*\}/g), ([block]) => [
          /font-family\s*:\s*["']?([^"';}]+)/.exec(block)![1].trim(),
          /url\(["']?([^"')]+)["']?\)/.exec(block)![1],
        ]),
      );
      expect(urlByFamily.get("Icons A")).not.toBe(urlByFamily.get("Icons B"));

      const fontOf = async (family: string): Promise<fontkit.Font> =>
        openFont((await fetchFont(dev.origin, urlByFamily.get(family)!)).body);

      const iconsA = await fontOf("Icons A");
      const iconsB = await fontOf("Icons B");
      expect(rendersLigature(iconsA, "close")).toBe(true);
      expect(rendersLigature(iconsA, "star")).toBe(false);
      expect(rendersLigature(iconsB, "star")).toBe(true);
      expect(rendersLigature(iconsB, "close")).toBe(false);
    });
  });
});

describe("Dev server: non-root base", () => {
  it(`should minify fonts served under base`, async () => {
    const FontExtract = await plugin({
      type: "manual",
      cache: false,
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
    });
    const server = await createServer({
      root: join(fixturesDir, "plain"),
      base: "/app/",
      configFile: false,
      logLevel: "silent",
      plugins: [FontExtract],
      server: { port: 0, strictPort: false },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      const port = typeof address === "object" && address ? address.port : 5173;
      const origin = `http://localhost:${port}`;

      const css = await fetchCss(origin, "/app/plain.css");
      const url = /url\(["']?([^"')]+\.woff2[^"')]*)["']?\)/.exec(css)?.[1];
      expect(url?.startsWith("/app/")).toBe(true);

      const response = await fetch(`${origin}${url}`);
      const size = (await response.arrayBuffer()).byteLength;
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(fontsLength.woff2);
    } finally {
      await server.close();
    }
  });
});

// `import url from './font.woff2?subset=ABC'` and `new URL(…)`: Vite serves the url with the query
const ASSET_IMPORT_RE = /from\s+["']([^"']+\.woff2\?[^"']*)["']/;
const EXPORTED_URL_RE = /export default\s+["']([^"']+)["']/;

describe("Dev server: ?subset= outside of @font-face", () => {
  const SUBSET_OPTIONS: PluginOption = { type: "manual", cache: false, targets: [] };

  const expectAbcFont = (body: Buffer): void => {
    expect(body.byteLength).toBeLessThan(textFontSource.byteLength);
    const font = openFont(body);
    expect(["A", "B", "C"].every((char) => font.hasGlyphForCodePoint(char.codePointAt(0)!))).toBe(
      true,
    );
    expect(font.hasGlyphForCodePoint("a".codePointAt(0)!)).toBe(false);
  };

  it("should minify a JS ?subset= import", async () => {
    const options: PluginOption = { ...SUBSET_OPTIONS, debug: true };
    await withDevServer(fixtures["subset-js"].path, options, async (dev) => {
      const js = await (await fetch(`${dev.origin}/index.js`)).text();
      const moduleUrl = ASSET_IMPORT_RE.exec(js)?.[1];
      expect(moduleUrl).toBeDefined();
      const assetModule = await (await fetch(`${dev.origin}${moduleUrl}`)).text();
      const fontUrl = EXPORTED_URL_RE.exec(assetModule)?.[1];
      expect(fontUrl).toMatch(/text-font\.woff2\?subset=ABC$/);

      const { status, body } = await fetchFont(dev.origin, fontUrl!);
      expect(status).toBe(200);
      expectAbcFont(body);
      expect(problemsOf(dev.messages)).toEqual([]);
      const registered = dev.messages.filter(({ message }) =>
        message.includes("dev: ?subset= request registered"),
      );
      expect(registered.map(({ message }) => message)).toEqual([
        expect.stringContaining('request registered, subset characters "ABC"'),
      ]);
    });
  });

  it("should minify a new URL() with ?subset=", async () => {
    await withDevServer(join(fixturesDir, "subset-new-url"), SUBSET_OPTIONS, async (dev) => {
      // Vite rewrites new URL() to the served path of the file, query included
      const js = await (await fetch(`${dev.origin}/index.js`)).text();
      const fontUrl = /new URL\("([^"]+)"/.exec(js)?.[1];
      expect(fontUrl).toMatch(/text-font\.woff2\?subset=ABC$/);

      const { status, body } = await fetchFont(dev.origin, fontUrl!);
      expect(status).toBe(200);
      expectAbcFont(body);
    });
  });
});

const WAIT_TIMEOUT_MS = 10_000;
const WAIT_INTERVAL_MS = 50;

// The dev server sees a file change once its watcher reports it
async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => {
      setTimeout(resolve, WAIT_INTERVAL_MS);
    });
  }
}

const iconFace = (family: string): string =>
  `@font-face {\n  font-family: "${family}";\n  src: url("../fonts/icon-font.woff2") format("woff2");\n}\n`;

describe("Dev server: served urls follow the stylesheet", () => {
  const options: PluginOption = {
    type: "manual",
    cache: false,
    targets: [
      { fontName: "Icons A", ligatures: ["close"] },
      { fontName: "Icons B", ligatures: ["star"] },
    ],
  };
  const iconFontSource = readFileSync(join(fixturesDir, "fonts", "icon-font.woff2"));

  // The fixture and its font are copied: the tests change the stylesheet on disk
  const createProject = (): { workDir: string; root: string } => {
    const workDir = join(outDir, `dev-follow-${generateId()}`);
    const root = join(workDir, "project");
    cpSync(devFixtures.serveFollow.path, root, { recursive: true });
    mkdirSync(join(workDir, "fonts"), { recursive: true });
    cpSync(
      join(fixturesDir, "fonts", "icon-font.woff2"),
      join(workDir, "fonts", "icon-font.woff2"),
    );
    return { workDir, root };
  };

  // `/@fs/…/icon-font.woff2?font-extractor-family=…` → `/@fs/…/icon-font.woff2`
  const plainUrlOf = (css: string): string => fontUrlsOf(css)[0].replace(/\?.*$/, "");

  it("should serve the plain url for the face of the last transform", async () => {
    const { workDir, root } = createProject();
    try {
      await withDevServer(root, options, async (dev) => {
        const plainUrl = plainUrlOf(await fetchCss(dev.origin, "/index.css"));
        const before = openFont((await fetchFont(dev.origin, plainUrl)).body);
        expect(rendersLigature(before, "close")).toBe(true);
        expect(rendersLigature(before, "star")).toBe(false);

        // Another family with other target options now comes first in the module
        writeFileSync(join(root, "index.css"), iconFace("Icons B") + iconFace("Icons A"));
        await waitFor(
          async () => (await fetchCss(dev.origin, "/index.css")).includes("Icons B"),
          "the changed stylesheet",
        );
        const after = openFont((await fetchFont(dev.origin, plainUrl)).body);
        expect(rendersLigature(after, "star")).toBe(true);
        expect(rendersLigature(after, "close")).toBe(false);
        expect(problemsOf(dev.messages)).toEqual([]);
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("should serve the original once the stylesheet is removed", async () => {
    const { workDir, root } = createProject();
    try {
      await withDevServer(root, options, async (dev) => {
        const css = await fetchCss(dev.origin, "/index.css");
        const [taggedUrl] = fontUrlsOf(css);
        const plainUrl = plainUrlOf(css);
        const minified = await fetchFont(dev.origin, plainUrl);
        expect(minified.body.byteLength).toBeLessThan(iconFontSource.byteLength);

        rmSync(join(root, "index.css"));
        await waitFor(
          async () =>
            (await fetchFont(dev.origin, plainUrl)).body.byteLength === iconFontSource.byteLength,
          "the plain url to serve the original",
        );
        const tagged = await fetchFont(dev.origin, taggedUrl);
        expect(tagged.body.equals(iconFontSource)).toBe(true);
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

const GOOGLE_URL_RE = /https:\/\/fonts\.googleapis\.com\/[^"')\s]+/g;

// `text=` of every Google Fonts url in the code, null where there is none
const googleTextsOf = (code: string): (string | null)[] =>
  Array.from(code.matchAll(GOOGLE_URL_RE), ([url]) =>
    new URL(url.replaceAll("&amp;", "&")).searchParams.get("text"),
  );

const fetchHtml = async (origin: string): Promise<string> =>
  (await fetch(`${origin}/`, { headers: { accept: "text/html" } })).text();

describe("Dev server: Google Fonts in auto mode", () => {
  it("should serve the full Google font whatever glyphs are known yet", async () => {
    const options: PluginOption = { type: "auto", cache: false };
    await withDevServer(devFixtures.googleAuto.path, options, async (dev) => {
      // The HTML is transformed before any stylesheet
      const firstHtml = await fetchHtml(dev.origin);
      const css = await fetchCss(dev.origin, "/index.css");
      // After a reload, while a lazy stylesheet is still to come
      const secondHtml = await fetchHtml(dev.origin);
      await fetchCss(dev.origin, "/lazy.css");
      const thirdHtml = await fetchHtml(dev.origin);

      expect(googleTextsOf(firstHtml)).toEqual([null]);
      expect(googleTextsOf(css)).toEqual([null]);
      expect(googleTextsOf(secondHtml)).toEqual([null]);
      expect(googleTextsOf(thirdHtml)).toEqual([null]);
      expect(dev.messages.filter((m) => m.type === "error")).toEqual([]);
    });
  });

  it("should keep text= of a target in auto mode", async () => {
    const options: PluginOption = {
      type: "auto",
      cache: false,
      targets: [{ fontName: "Material Icons", ligatures: ["close"] }],
    };
    await withDevServer(devFixtures.googleAuto.path, options, async (dev) => {
      expect(googleTextsOf(await fetchHtml(dev.origin))).toEqual(["close"]);
    });
  });
});

describe("Dev server: auto mode glyph changes", () => {
  it("should give the auto font a new url when another stylesheet adds glyphs", async () => {
    const options: PluginOption = { type: "auto", cache: false };
    await withDevServer(devFixtures.autoTwoCss.path, options, async (dev) => {
      const [before] = fontUrlsOf(await fetchCss(dev.origin, "/font.css"));

      await fetchCss(dev.origin, "/icons.css");
      // The font module is transformed again once the glyph change settles
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
      const [after] = fontUrlsOf(await fetchCss(dev.origin, "/font.css"));
      expect(after).not.toBe(before);

      const font = openFont((await fetchFont(dev.origin, after)).body);
      expect(font.hasGlyphForCodePoint(CLOSE_CODE_POINT)).toBe(true);
      expect(font.hasGlyphForCodePoint(PLAY_ARROW_CODE_POINT)).toBe(true);
      expect(dev.messages.filter((m) => m.type === "error")).toEqual([]);
    });
  });
});
