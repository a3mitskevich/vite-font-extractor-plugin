import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createServerV5 } from "vite-5";
import { createServer as createServerV6 } from "vite-6";
import { createServer as createServerV7, type ViteDevServer } from "vite-7";
import { createServer as createServerV8 } from "vite-8";
import * as fontkit from "fontkit";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import type { PluginOption } from "../src";
import {
  plugin,
  fixturesDir,
  fixtures,
  fontsLength,
  createFixture,
  type LoggerMessage,
} from "./utils";

type CreateServer = typeof createServerV7;

const devServers: Record<string, CreateServer> = {
  "vite@5": createServerV5 as unknown as CreateServer,
  "vite@6": createServerV6 as unknown as CreateServer,
  "vite@7": createServerV7,
  "vite@8": createServerV8 as unknown as CreateServer,
};

const devFixtures = {
  textFont: createFixture("dev-text-font"),
  autoTwoCss: createFixture("dev-auto-two-css"),
  fontQuery: createFixture("dev-font-query"),
};

const CLOSE_CODE_POINT = 0xe5cd;
const PLAY_ARROW_CODE_POINT = 0xe037;
const textFontSource = readFileSync(join(fixturesDir, "fonts", "text-font.woff2"));

function createMessageLogger(): { logger: any; messages: LoggerMessage[] } {
  const messages: LoggerMessage[] = [];
  const logger = new Proxy(
    {},
    {
      get(_: any, key: any): any {
        if (key === "clearScreen" || key === "hasErrorLogged") return () => false;
        return (message: string) => {
          messages.push({ type: key, message: stripVTControlCharacters(String(message)) });
        };
      },
    },
  );
  return { logger, messages };
}

interface DevSession {
  origin: string;
  messages: LoggerMessage[];
}

async function withDevServer(
  createServer: CreateServer,
  root: string,
  pluginOptions: PluginOption | undefined,
  run: (session: DevSession) => Promise<void>,
): Promise<void> {
  const { logger, messages } = createMessageLogger();
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

const openFont = (body: Buffer): fontkit.Font => fontkit.create(body) as fontkit.Font;

// Only for fonts that contain the ligature: fontkit fails on a missing one in WOFF
const rendersLigature = (font: fontkit.Font, text: string): boolean => {
  const glyphs = font.layout(text).glyphs;
  return glyphs.length === 1 && glyphs[0].id !== 0;
};

const problemsOf = (messages: LoggerMessage[]): LoggerMessage[] =>
  messages.filter((m) => m.type === "warn" || m.type === "error");

const flushRejections = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 100);
  });

describe.sequential("Dev server", () => {
  let server: ViteDevServer;
  let baseUrl: string;
  const { logger, messages: logMessages } = createMessageLogger();

  beforeAll(async () => {
    const FontExtract = await plugin({
      type: "manual",
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
    });

    server = await createServerV7({
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
    const response = await fetch(`${baseUrl}/@fs${fontPath}`);
    expect(response.ok).toBeTruthy();

    const body = await response.arrayBuffer();
    // Font should be minified (smaller than original)
    expect(body.byteLength).toBeLessThan(originalSize);
    expect(body.byteLength).toBeGreaterThan(0);
  });

  it("should serve every font format minified", async () => {
    for (const ext of ["woff2", "woff", "ttf", "eot"] as const) {
      const fontPath = join(fixturesDir, "fonts", `icon-font.${ext}`);
      const { status, body } = await fetchFont(baseUrl, `/@fs${fontPath}`);
      expect(status).toBe(200);
      expect(body.byteLength).toBeGreaterThan(0);
      expect(body.byteLength).toBeLessThan(fontsLength[ext]);
      // fontkit cannot read EOT
      if (ext !== "eot") {
        expect(rendersLigature(openFont(body), "close")).toBe(true);
      }
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

    const response1 = await fetch(`${baseUrl}/@fs${fontPath}`);
    const body1 = await response1.arrayBuffer();

    const response2 = await fetch(`${baseUrl}/@fs${fontPath}`);
    const body2 = await response2.arrayBuffer();

    // Same size = cached result reused
    expect(body1.byteLength).toBe(body2.byteLength);
  });
});

describe.sequential("Dev server: minification errors", () => {
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

  for (const [label, createServer] of Object.entries(devServers)) {
    it(`${label}: should serve the original font and keep running when minification fails`, async () => {
      rejections.length = 0;
      // `characters` needs `engine: "subset"` — fontext rejects this target
      const options: PluginOption = {
        type: "manual",
        cache: false,
        targets: [{ fontName: "Text Font", characters: "abc" }],
      };
      await withDevServer(createServer, devFixtures.textFont.path, options, async (dev) => {
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

    it(`${label}: should serve the original font in auto mode before any glyph is found`, async () => {
      rejections.length = 0;
      await withDevServer(createServer, devFixtures.textFont.path, undefined, async (dev) => {
        const [url] = fontUrlsOf(await fetchCss(dev.origin, "/index.css"));

        const { status, body } = await fetchFont(dev.origin, url);
        await flushRejections();
        expect(rejections).toEqual([]);
        expect(status).toBe(200);
        expect(body.equals(textFontSource)).toBe(true);
        expect(dev.messages.filter((m) => m.type === "error")).toEqual([]);
      });
    });
  }
});

describe.sequential("Dev server: Vite 5–8 matrix", () => {
  for (const [label, createServer] of Object.entries(devServers)) {
    it(`${label}: should minify a manual target`, async () => {
      const options: PluginOption = {
        type: "manual",
        cache: false,
        targets: [{ fontName: "Font Name", ligatures: ["close"] }],
      };
      await withDevServer(createServer, fixtures.plain.path, options, async (dev) => {
        const urls = fontUrlsOf(await fetchCss(dev.origin, "/plain.css"));
        const woff2 = urls.find((url) => url.includes(".woff2"))!;

        const { status, body } = await fetchFont(dev.origin, woff2);
        expect(status).toBe(200);
        expect(body.byteLength).toBeLessThan(fontsLength.woff2);
        expect(rendersLigature(openFont(body), "close")).toBe(true);
        expect(problemsOf(dev.messages)).toEqual([]);
      });
    });

    it(`${label}: should collect auto glyphs from several CSS files`, async () => {
      const options: PluginOption = { type: "auto", cache: false };
      await withDevServer(createServer, devFixtures.autoTwoCss.path, options, async (dev) => {
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

    it(`${label}: should minify a font whose url carries ?v=`, async () => {
      const options: PluginOption = {
        type: "manual",
        cache: false,
        targets: [{ fontName: "Font Name", ligatures: ["close"] }],
      };
      await withDevServer(createServer, devFixtures.fontQuery.path, options, async (dev) => {
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

    it(`${label}: should merge ?subset= in CSS with the target like build`, async () => {
      const options: PluginOption = {
        type: "manual",
        cache: false,
        targets: [{ fontName: "Text Font", engine: "subset", characters: "xyz" }],
      };
      await withDevServer(createServer, fixtures["subset-chars"].path, options, async (dev) => {
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
  }
});

describe.sequential("Dev server: file shared by families with different options", () => {
  for (const [label, createServer] of Object.entries(devServers)) {
    it(`${label}: should serve each family its own minified font`, async () => {
      const options: PluginOption = {
        type: "manual",
        cache: false,
        targets: [
          { fontName: "Icons A", ligatures: ["close"] },
          { fontName: "Icons B", ligatures: ["star"] },
        ],
      };
      await withDevServer(
        createServer,
        fixtures["shared-file-families"].path,
        options,
        async (dev) => {
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
        },
      );
    });
  }
});

describe.sequential("Dev server: non-root base", () => {
  const servers = { "vite@7": createServerV7, "vite@8": createServerV8 };

  for (const [label, createServer] of Object.entries(servers)) {
    it(`${label}: should minify fonts served under base`, async () => {
      const FontExtract = await plugin({
        type: "manual",
        cache: false,
        targets: [{ fontName: "Font Name", ligatures: ["close"] }],
      });
      const server = await (createServer as CreateServer)({
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
  }
});
