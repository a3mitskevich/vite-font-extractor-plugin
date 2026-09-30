import { describe, it, expect } from "vitest";
import { createServer as createServerV5 } from "vite-5";
import { createServer as createServerV6 } from "vite-6";
import { createServer as createServerV7 } from "vite-7";
import { createServer as createServerV8 } from "vite-8";
import type { OutputAsset } from "rollup";
import type { PluginOption } from "../src";
import {
  buildByVersion,
  type ContainerVersion,
  fixtures,
  fontsLength,
  plugin,
  viteBuild,
} from "./utils";

type CreateServer = typeof createServerV7;

const devServers: Record<string, CreateServer> = {
  "vite@5": createServerV5 as unknown as CreateServer,
  "vite@6": createServerV6 as unknown as CreateServer,
  "vite@7": createServerV7,
  "vite@8": createServerV8 as unknown as CreateServer,
};

const TARGETS = [{ fontName: "Font Name", ligatures: ["close"] }];
const MISSING_TYPE_WARNING = 'type is not set, falling back to "manual"';

const fontSizesOf = (output: unknown[]): Record<string, number> =>
  Object.fromEntries(
    (output as OutputAsset[])
      .filter((item) => item.type === "asset" && /\.(woff2?|ttf|eot)$/.test(item.fileName))
      .map((item) => [item.fileName.split(".").pop()!, Buffer.from(item.source).length]),
  );

async function fetchDevFontSize(
  createServer: CreateServer,
  pluginOptions: PluginOption,
): Promise<number> {
  const server = await createServer({
    root: fixtures.plain.path,
    configFile: false,
    logLevel: "silent",
    plugins: [await plugin(pluginOptions)],
    server: { port: 0, strictPort: false, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : 5173;
    const origin = `http://localhost:${port}`;
    const css = await (
      await fetch(`${origin}/plain.css`, { headers: { accept: "text/css" } })
    ).text();
    const url = /url\(["']?([^"')]+\.woff2[^"')]*)["']?\)/.exec(css)![1];
    return (await (await fetch(`${origin}${url}`)).arrayBuffer()).byteLength;
  } finally {
    await server.close();
  }
}

describe.sequential("Plugin options: apply and type", () => {
  const runBuildTests = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      it('apply: "serve" should keep fonts untouched in build', async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          pluginOptions: { type: "manual", apply: "serve", cache: false, targets: TARGETS },
        });
        const sizes = fontSizesOf(output);
        expect(Object.keys(sizes).sort()).toEqual(["eot", "ttf", "woff", "woff2"]);
        for (const [ext, size] of Object.entries(sizes)) {
          expect(size, ext).toBe(fontsLength[ext as keyof typeof fontsLength]);
        }
      });

      it('apply: "build" should minify fonts in build', async () => {
        const { output } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          pluginOptions: { type: "manual", apply: "build", cache: false, targets: TARGETS },
        });
        const sizes = fontSizesOf(output);
        expect(sizes.woff2).toBeLessThan(fontsLength.woff2);
      });

      it("should warn and fall back to manual mode when type is not set", async () => {
        const { output, messages } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          pluginOptions: { cache: false, targets: TARGETS } as unknown as PluginOption,
        });
        const warnings = messages.filter((m) => m.type === "warn");
        expect(warnings.some((m) => m.message.includes(MISSING_TYPE_WARNING))).toBe(true);
        expect(fontSizesOf(output).woff2).toBeLessThan(fontsLength.woff2);
      });

      it("should not warn about type when it is set", async () => {
        const { messages } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          pluginOptions: { type: "manual", cache: false, targets: TARGETS },
        });
        expect(messages.some((m) => m.message.includes(MISSING_TYPE_WARNING))).toBe(false);
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runBuildTests(version as ContainerVersion);
  });

  for (const [label, createServer] of Object.entries(devServers)) {
    it(`${label}: apply: "build" should serve the original font in dev`, async () => {
      const size = await fetchDevFontSize(createServer, {
        type: "manual",
        apply: "build",
        cache: false,
        targets: TARGETS,
      });
      expect(size).toBe(fontsLength.woff2);
    });

    it(`${label}: apply: "serve" should minify fonts in dev`, async () => {
      const size = await fetchDevFontSize(createServer, {
        type: "manual",
        apply: "serve",
        cache: false,
        targets: TARGETS,
      });
      expect(size).toBeLessThan(fontsLength.woff2);
    });
  }
});
