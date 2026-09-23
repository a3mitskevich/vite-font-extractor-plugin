import { describe, it, expect, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { PluginOption, Target } from "../src";
import {
  buildByVersion,
  type BuildOptions,
  type ContainerVersion,
  findBrokenFontReferences,
  fixtures,
  generateId,
  getFontAssets,
  getReadableFontAssets,
  hasAnyGlyphFor,
  hasGlyph,
  hasGlyphsFor,
  type LoggerMessage,
  openFont,
  type OutputItem,
  outDir,
  rendersLigature,
  viteBuild,
} from "./utils";

const CLOSE = 0xe5cd;
const CLOSE_FULLSCREEN = 0xe5ce;
const STAR = 0xe838;
const DIGITS = "0123456789";
const FIRST_BUILD_TIME = 1_577_836_800_000;
const CLOCK_STEP_MS = 2_000;

const iconBuild = (version: ContainerVersion, target: Target, options: BuildOptions = {}) =>
  buildByVersion(version, {
    fixture: fixtures.plain.path,
    pluginOptions: { type: "manual", targets: [{ ...target, fontName: "Font Name" }] },
    ...options,
  });

const textBuild = (version: ContainerVersion, target: Target, fixture = "subset-target-chars") =>
  buildByVersion(version, {
    fixture: fixtures[fixture as keyof typeof fixtures].path,
    pluginOptions: { type: "manual", targets: [{ ...target, fontName: "Text Font" }] },
  });

const readableFonts = (output: unknown[]) => {
  const items = output as OutputItem[];
  expect(findBrokenFontReferences(items)).toEqual([]);
  const assets = getReadableFontAssets(items);
  expect(assets.length).toBeGreaterThan(0);
  return assets.map((asset) => ({ name: asset.fileName, font: openFont(asset.source) }));
};

const problems = (messages: LoggerMessage[]) =>
  messages.filter((m) => m.type === "warn" || m.type === "error");

// Markers of the three log types the "log-levels" fixture produces
const LOG_MARKERS = {
  info: "Config —",
  warn: 'Font "Untargeted" has no minify options',
  error: 'Failed to minify "Broken"',
} as const;

type LogType = keyof typeof LOG_MARKERS;

const LOG_LEVEL_TARGETS: Target[] = [
  { fontName: "Icons", ligatures: ["close"] },
  { fontName: "Broken", ligatures: ["close"] },
];

// Vite's logger writes info to console.log, warn to console.warn, error to console.error
const captureConsole = async (run: () => Promise<unknown>): Promise<Record<LogType, boolean>> => {
  const lines: Record<LogType, string[]> = { info: [], warn: [], error: [] };
  const record =
    (type: LogType) =>
    (...args: unknown[]) => {
      lines[type].push(args.map(String).join(" "));
    };
  const spies = [
    vi.spyOn(console, "log").mockImplementation(record("info")),
    vi.spyOn(console, "warn").mockImplementation(record("warn")),
    vi.spyOn(console, "error").mockImplementation(record("error")),
  ];
  try {
    await run();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  const printed = Object.values(lines).flat();
  return {
    info: printed.some((line) => line.includes(LOG_MARKERS.info)),
    warn: printed.some((line) => line.includes(LOG_MARKERS.warn)),
    error: printed.some((line) => line.includes(LOG_MARKERS.error)),
  };
};

describe.sequential("Target and plugin options", () => {
  const runTargetOptionTests = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      it("raws: should keep the glyphs of the given characters", async () => {
        const { output, messages } = await iconBuild(version, {
          fontName: "",
          raws: [String.fromCodePoint(CLOSE), String.fromCodePoint(STAR)],
        });

        expect(problems(messages)).toEqual([]);
        readableFonts(output).forEach(({ name, font }) => {
          expect(hasGlyph(font, CLOSE), name).toBe(true);
          expect(hasGlyph(font, STAR), name).toBe(true);
          expect(hasGlyph(font, CLOSE_FULLSCREEN), name).toBe(false);
          // raws resolve to their ligatures
          expect(rendersLigature(font, "close"), name).toBe(true);
          expect(rendersLigature(font, "play_arrow"), name).toBe(false);
        });
      });

      it("unicodeRanges (icon engine): should keep the code points in range", async () => {
        const { output, messages } = await iconBuild(version, {
          fontName: "",
          unicodeRanges: ["U+E5CD-E5CE"],
        });

        expect(problems(messages)).toEqual([]);
        readableFonts(output).forEach(({ name, font }) => {
          expect(hasGlyph(font, CLOSE), name).toBe(true);
          expect(hasGlyph(font, CLOSE_FULLSCREEN), name).toBe(true);
          expect(hasGlyph(font, STAR), name).toBe(false);
        });
      });

      it("unicodeRanges (subset engine): should keep the characters in range", async () => {
        const { output, messages } = await textBuild(version, {
          fontName: "",
          engine: "subset",
          unicodeRanges: ["U+0041-005A"],
        });

        expect(problems(messages)).toEqual([]);
        readableFonts(output).forEach(({ name, font }) => {
          expect(hasGlyphsFor(font, "ABCMXYZ"), name).toBe(true);
          expect(hasAnyGlyphFor(font, `abcxyz${DIGITS}`), name).toBe(false);
        });
      });

      it("withWhitespace: should add the space glyph only when enabled", async () => {
        const target: Target = { fontName: "", engine: "subset", characters: "Hello" };
        const withSpace = await textBuild(version, { ...target, withWhitespace: true });
        const withoutSpace = await textBuild(version, target);

        readableFonts(withSpace.output).forEach(({ name, font }) => {
          expect(hasGlyphsFor(font, "Helo "), name).toBe(true);
        });
        readableFonts(withoutSpace.output).forEach(({ name, font }) => {
          expect(hasGlyphsFor(font, "Helo"), name).toBe(true);
          expect(hasAnyGlyphFor(font, " "), name).toBe(false);
        });
      });

      it("?subset= merged with the target: should keep both character sets", async () => {
        // The fixture requests ?subset=ABC, the target adds "xyz"
        const { output, messages } = await textBuild(
          version,
          { fontName: "", engine: "subset", characters: "xyz" },
          "subset-chars",
        );

        expect(problems(messages)).toEqual([]);
        readableFonts(output).forEach(({ name, font }) => {
          expect(hasGlyphsFor(font, "ABCxyz"), name).toBe(true);
          expect(hasAnyGlyphFor(font, `DEFabc${DIGITS}`), name).toBe(false);
        });
      });

      describe("logLevel", () => {
        const logBuild = (logLevel: PluginOption["logLevel"], options: BuildOptions = {}) =>
          buildByVersion(version, {
            fixture: fixtures["log-levels"].path,
            pluginOptions: { type: "manual", targets: LOG_LEVEL_TARGETS, logLevel, cache: false },
            ...options,
          });

        const cases: Array<[PluginOption["logLevel"], Record<LogType, boolean>]> = [
          ["info", { info: true, warn: true, error: true }],
          ["warn", { info: false, warn: true, error: true }],
          ["error", { info: false, warn: false, error: true }],
          ["silent", { info: false, warn: false, error: false }],
        ];

        cases.forEach(([logLevel, expected]) => {
          it(`should print only allowed messages with "${logLevel}" (Vite logger)`, async () => {
            // Vite's own output is silenced by the build config; the plugin level wins
            const printed = await captureConsole(() =>
              logBuild(logLevel, { useConsoleLogger: true }),
            );
            expect(printed).toEqual(expected);
          });
        });

        // Current behaviour: Vite's createLogger returns a customLogger unchanged, so the
        // plugin logLevel does not filter anything that goes to a custom logger
        it('should pass every message to a customLogger even with "silent"', async () => {
          const { messages } = await logBuild("silent");
          const types = new Set(
            (Object.keys(LOG_MARKERS) as LogType[]).filter((type) =>
              messages.some((m) => m.type === type && m.message.includes(LOG_MARKERS[type])),
            ),
          );
          expect(types).toEqual(new Set(["info", "warn", "error"]));
        });
      });

      it("cache: should reuse cached fonts in the second build with identical output", async () => {
        const cache = join(outDir, `target-options-cache-${generateId()}`);
        // A fresh minification in another second differs (svg2ttf timestamps, see hash.spec)
        const buildAt = async (time: number) => {
          vi.useFakeTimers({ toFake: ["Date"], now: time });
          try {
            return await buildByVersion(version, {
              fixture: fixtures.plain.path,
              pluginOptions: {
                type: "manual",
                targets: [{ fontName: "Font Name", ligatures: ["close"] }],
                cache,
              },
            });
          } finally {
            vi.useRealTimers();
          }
        };
        try {
          const first = await buildAt(FIRST_BUILD_TIME);
          const second = await buildAt(FIRST_BUILD_TIME + CLOCK_STEP_MS);

          const cachedLog = (messages: LoggerMessage[]) =>
            messages.filter((m) => m.type === "info" && m.message.includes("cached"));
          expect(cachedLog(first.messages)).toEqual([]);
          expect(cachedLog(second.messages)).toHaveLength(1);

          const fonts = (output: unknown[]) =>
            getFontAssets(output as OutputItem[])
              .map((asset) => [asset.fileName, Buffer.from(asset.source).toString("base64")])
              .sort(([a], [b]) => a.localeCompare(b));
          expect(fonts(second.output)).toHaveLength(4);
          expect(fonts(second.output)).toEqual(fonts(first.output));
          expect(findBrokenFontReferences(second.output as OutputItem[])).toEqual([]);
        } finally {
          rmSync(cache, { recursive: true, force: true });
        }
      });
    });
  };

  // Options are passed through to fontext; the oldest and newest Vite cover the plugin paths
  Object.keys(viteBuild)
    .filter((version) => /^[58]\./.test(version))
    .forEach((version) => {
      runTargetOptionTests(version);
    });
});
