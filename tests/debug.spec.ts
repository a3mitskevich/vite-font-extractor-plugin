import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { PluginOption } from "../src";
import { createInternalLogger, isDebugEnabled } from "../src/internal-logger";
import { join } from "node:path";
import { buildFixture, createFakeLogger, fixtures, fixturesDir, type LoggerMessage } from "./utils";

const DEBUG_MARK = "[debug]";
const ICON_TARGET = { fontName: "Font Name", ligatures: ["close"] };

const manualOptions = (debug?: boolean): PluginOption => ({
  type: "manual",
  targets: [ICON_TARGET],
  cache: false,
  ...(debug === undefined ? {} : { debug }),
});

const debugLines = (messages: LoggerMessage[]): string[] =>
  messages
    .filter(({ type, message }) => type === "info" && message.includes(DEBUG_MARK))
    .map(({ message }) => message);

const hasLine = (lines: string[], ...parts: string[]): boolean =>
  lines.some((line) => parts.every((part) => line.includes(part)));

describe("Debug tracing", () => {
  let savedDebug: string | undefined;

  beforeEach(() => {
    savedDebug = process.env.DEBUG;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    if (savedDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = savedDebug;
  });

  it("traces a face found and minified before vite:css (L1)", async () => {
    const { messages } = await buildFixture({
      fixture: fixtures.plain.path,
      pluginOptions: manualOptions(true),
    });
    const lines = debugLines(messages);
    expect(hasLine(lines, 'L1: @font-face "Font Name"', "icon-font.woff2")).toBe(true);
    expect(hasLine(lines, 'options: "Font Name" → target')).toBe(true);
    expect(hasLine(lines, 'minify "Font Name" .woff2:', "B →")).toBe(true);
    expect(hasLine(lines, "emit: asset assets/icon-font-", ".woff2")).toBe(true);
    // Paths under the root are printed relative to it
    expect(hasLine(lines, "L1: @font-face", "plain.css")).toBe(true);
    expect(lines.some((line) => line.includes(fixtures.plain.path + "/"))).toBe(false);
  });

  it("traces the source lookup of a face compiled from a Sass mixin (L2)", async () => {
    const { messages } = await buildFixture({
      fixture: fixtures.mixins.path,
      pluginOptions: manualOptions(true),
    });
    const lines = debugLines(messages);
    expect(hasLine(lines, 'L2: @font-face "Font Name"', "asset assets/icon-font-")).toBe(true);
    expect(hasLine(lines, "L2: candidates", "icon-font.woff")).toBe(true);
    expect(hasLine(lines, "L2: probe", "matches")).toBe(true);
    expect(hasLine(lines, 'L2: "Font Name"', "swapped for the minified font")).toBe(true);
    expect(hasLine(lines, "cleanup: removed assets/icon-font-")).toBe(true);
  });

  it("traces the graph wait of auto mode", async () => {
    const { messages } = await buildFixture({
      fixture: fixtures.auto.path,
      pluginOptions: { type: "auto", cache: false, debug: true },
    });
    const lines = debugLines(messages);
    expect(hasLine(lines, 'L1: "Font Name" is auto — left to L2')).toBe(true);
    expect(hasLine(lines, "auto: 1 glyphs in CSS content")).toBe(true);
    expect(hasLine(lines, "graph wait: starts", "modules not parsed yet")).toBe(true);
    expect(hasLine(lines, "graph wait: released")).toBe(true);
  });

  it("traces a JS ?subset= import", async () => {
    const { messages } = await buildFixture({
      fixture: fixtures["subset-js"].path,
      pluginOptions: { type: "manual", targets: [], cache: false, debug: true },
    });
    const lines = debugLines(messages);
    expect(
      hasLine(
        lines,
        "subset import: ../fonts/text-font.woff2?subset=ABC →",
        "text-font.woff2?subset=ABC (module of the plugin)",
        "index.js",
      ),
    ).toBe(true);
    expect(
      hasLine(
        lines,
        'subset import: load, subset characters "ABC" → minified (',
        "text-font.woff2",
      ),
    ).toBe(true);
    expect(hasLine(lines, "emit: asset assets/text-font-", ".woff2")).toBe(true);
  });

  it("traces a new URL() with ?subset= rewritten into an import", async () => {
    const { messages } = await buildFixture({
      fixture: join(fixturesDir, "subset-new-url"),
      pluginOptions: { type: "manual", targets: [], cache: false, debug: true },
    });
    const lines = debugLines(messages);
    expect(
      hasLine(
        lines,
        "new URL: ../fonts/text-font.woff2?subset=ABC rewritten into an import",
        "index.js",
      ),
    ).toBe(true);
    expect(hasLine(lines, "subset import: ../fonts/text-font.woff2?subset=ABC →")).toBe(true);
    expect(hasLine(lines, 'subset import: load, subset characters "ABC" → minified (')).toBe(true);
  });

  it("prints nothing without the option or DEBUG", async () => {
    const results = await Promise.all([
      buildFixture({ fixture: fixtures.plain.path, pluginOptions: manualOptions() }),
      buildFixture({ fixture: fixtures.mixins.path, pluginOptions: manualOptions() }),
      buildFixture({ fixture: fixtures.auto.path, pluginOptions: { type: "auto", cache: false } }),
    ]);
    for (const { messages } of results) {
      expect(messages.some(({ type }) => type === "info")).toBe(true);
      expect(debugLines(messages)).toEqual([]);
    }
  });

  it("is enabled by DEBUG=vite-font-extractor", async () => {
    process.env.DEBUG = "vite:*,vite-font-extractor";
    const { messages } = await buildFixture({
      fixture: fixtures.plain.path,
      pluginOptions: manualOptions(),
    });
    expect(hasLine(debugLines(messages), 'L1: @font-face "Font Name"')).toBe(true);
  });

  it("is disabled by debug: false even with DEBUG set", async () => {
    process.env.DEBUG = "*";
    const { messages } = await buildFixture({
      fixture: fixtures.plain.path,
      pluginOptions: manualOptions(false),
    });
    expect(debugLines(messages)).toEqual([]);
  });

  describe("isDebugEnabled", () => {
    const cases: Array<[boolean | undefined, string | undefined, boolean]> = [
      [undefined, undefined, false],
      [undefined, "", false],
      [undefined, "vite-font-extractor", true],
      [undefined, "*", true],
      [undefined, "vite:*, vite-font-extractor:*", true],
      [undefined, "vite:*", false],
      [undefined, "-vite-font-extractor", false],
      [true, undefined, true],
      [false, "vite-font-extractor", false],
    ];
    cases.forEach(([option, env, expected]) => {
      it(`option ${String(option)}, DEBUG=${JSON.stringify(env)} → ${expected}`, () => {
        expect(isDebugEnabled(option, env)).toBe(expected);
      });
    });
  });

  describe("logger.debug", () => {
    it("does not build the message when debug is off", () => {
      const customLogger = createFakeLogger();
      const logger = createInternalLogger("info", customLogger);
      let isBuilt = false;
      logger.debug(() => {
        isBuilt = true;
        return "costly";
      });
      expect(logger.isDebug).toBe(false);
      expect(isBuilt).toBe(false);
      expect(customLogger.messages).toEqual([]);
    });

    it("prints an info line with the path relative to the root", () => {
      const customLogger = createFakeLogger();
      const logger = createInternalLogger("info", customLogger, {
        isEnabled: true,
        root: "/project",
      });
      logger.debug(() => "found /project/fonts/a.woff2", "/project/src/a.css");
      expect(customLogger.messages).toHaveLength(1);
      const [{ type, message }] = customLogger.messages;
      expect(type).toBe("info");
      expect(message).toContain("[debug] found fonts/a.woff2");
      expect(message).toContain("src/a.css");
      expect(message).not.toContain("/project/");
    });
  });
});
