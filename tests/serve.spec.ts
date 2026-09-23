import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createServerV7, type ViteDevServer } from "vite-7";
import { createServer as createServerV8 } from "vite-8";
import * as fontkit from "fontkit";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { plugin, fixturesDir, fontsLength } from "./utils";

describe.sequential("Dev server", () => {
  let server: ViteDevServer;
  let baseUrl: string;
  const logMessages: { type: string; message: string }[] = [];

  beforeAll(async () => {
    const customLogger = new Proxy(
      {},
      {
        get(_: any, key: any): any {
          if (key === "clearScreen" || key === "hasErrorLogged") return () => false;
          return (message: string) => {
            logMessages.push({ type: key, message });
          };
        },
      },
    );

    const FontExtract = await plugin({
      type: "manual",
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
    });

    server = await createServerV7({
      root: join(fixturesDir, "plain"),
      configFile: false,
      logLevel: "silent",
      customLogger: customLogger as any,
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

  it("should serve all font formats", async () => {
    for (const ext of ["woff2", "woff", "ttf", "eot"] as const) {
      const fontPath = join(fixturesDir, "fonts", `icon-font.${ext}`);
      const response = await fetch(`${baseUrl}/@fs${fontPath}`);
      expect(response.ok).toBeTruthy();

      const body = await response.arrayBuffer();
      // Minified font should be <= original (some formats may not shrink)
      expect(body.byteLength).toBeLessThanOrEqual(fontsLength[ext]);
      expect(body.byteLength).toBeGreaterThan(0);
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

describe.sequential("Dev server: file shared by families with different options", () => {
  const servers = { "vite@7": createServerV7, "vite@8": createServerV8 };

  for (const [label, createServer] of Object.entries(servers)) {
    it(`${label}: should serve each family its own minified font`, async () => {
      const FontExtract = await plugin({
        type: "manual",
        cache: false,
        targets: [
          { fontName: "Icons A", ligatures: ["close"] },
          { fontName: "Icons B", ligatures: ["star"] },
        ],
      });
      const server = await (createServer as typeof createServerV7)({
        root: join(fixturesDir, "shared-file-families"),
        configFile: false,
        logLevel: "silent",
        plugins: [FontExtract],
        server: { port: 0, strictPort: false },
      });
      try {
        await server.listen();
        const address = server.httpServer?.address();
        const port = typeof address === "object" && address ? address.port : 5173;
        const baseUrl = `http://localhost:${port}`;

        const css = await (
          await fetch(`${baseUrl}/index.css`, { headers: { accept: "text/css" } })
        ).text();
        const urlByFamily = new Map(
          Array.from(css.matchAll(/@font-face\s*\{[^}]*\}/g), ([block]) => [
            /font-family\s*:\s*["']?([^"';}]+)/.exec(block)![1].trim(),
            /url\(["']?([^"')]+)["']?\)/.exec(block)![1],
          ]),
        );
        expect(urlByFamily.get("Icons A")).not.toBe(urlByFamily.get("Icons B"));

        const fontOf = async (family: string): Promise<fontkit.Font> => {
          const response = await fetch(`${baseUrl}${urlByFamily.get(family)}`);
          return fontkit.create(Buffer.from(await response.arrayBuffer())) as fontkit.Font;
        };
        const rendersLigature = (font: fontkit.Font, text: string): boolean => {
          const glyphs = font.layout(text).glyphs;
          return glyphs.length === 1 && glyphs[0].id !== 0;
        };

        const iconsA = await fontOf("Icons A");
        const iconsB = await fontOf("Icons B");
        expect(rendersLigature(iconsA, "close")).toBe(true);
        expect(rendersLigature(iconsA, "star")).toBe(false);
        expect(rendersLigature(iconsB, "star")).toBe(true);
        expect(rendersLigature(iconsB, "close")).toBe(false);
      } finally {
        await server.close();
      }
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
      const server = await (createServer as typeof createServerV7)({
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

        const css = await (
          await fetch(`${origin}/app/plain.css`, { headers: { accept: "text/css" } })
        ).text();
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
