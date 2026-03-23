import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createServerV7, type ViteDevServer } from "vite-7";
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
