import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extract, type Formats, type MinifyOption } from "fontext";
import type { OutputAsset } from "./utils";
import type { PluginOption } from "../src";
import { buildFixture, fixtures, fixturesDir } from "./utils";

function getFontFileNames(output: OutputAsset[]): string[] {
  return output
    .filter((a): a is OutputAsset => a.type === "asset" && a.fileName.includes("font"))
    .map((a) => a.fileName)
    .sort();
}

const MANUAL_CLOSE: PluginOption = {
  type: "manual",
  targets: [{ fontName: "Font Name", ligatures: ["close"] }],
};

// 2020-01-01T00:00:00Z; fontext 1 (svg2ttf) wrote the time with one second resolution
const FIRST_TIME = 1_577_836_800_000;
const CLOCK_STEP_MS = 2_000;
const ALL_FORMATS: Formats[] = ["woff2", "woff", "ttf", "eot", "svg"];
// The subset engine does not write SVG fonts
const SUBSET_FORMATS: Formats[] = ["woff2", "woff", "ttf", "eot"];

const extractAt = async (time: number, font: string, option: MinifyOption) => {
  vi.useFakeTimers({ toFake: ["Date"], now: time });
  try {
    return await extract(readFileSync(join(fixturesDir, "fonts", font)), option);
  } finally {
    vi.useRealTimers();
  }
};

const buildAt = async (time: number, options: Parameters<typeof buildFixture>[0]) => {
  vi.useFakeTimers({ toFake: ["Date"], now: time });
  try {
    return await buildFixture(options);
  } finally {
    vi.useRealTimers();
  }
};

const namesAt = async (time: number, options: Parameters<typeof buildFixture>[0]) =>
  getFontFileNames((await buildAt(time, options)).output as OutputAsset[]);

describe("Hash consistency", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("deterministic minification", () => {
    const ENGINES: Array<[string, string, MinifyOption & { formats: Formats[] }]> = [
      [
        "icon",
        "icon-font.woff2",
        { fontName: "icons", ligatures: ["close", "play_arrow"], formats: ALL_FORMATS },
      ],
      [
        "subset",
        "text-font.woff2",
        { fontName: "text", engine: "subset", characters: "ABCabc", formats: SUBSET_FORMATS },
      ],
    ];

    it.each(ENGINES)(
      "%s engine: every format is byte-identical when the clock moves",
      async (_, font, option) => {
        const first = await extractAt(FIRST_TIME, font, option);
        const second = await extractAt(FIRST_TIME + CLOCK_STEP_MS, font, option);
        for (const format of option.formats) {
          expect(first[format]?.length, format).toBeGreaterThan(0);
          expect(first[format]?.equals(second[format]!), format).toBe(true);
        }
      },
    );
  });

  describe("manual mode", () => {
    it("should produce same file names for same config across builds", async () => {
      const options = { fixture: fixtures.plain.path, pluginOptions: MANUAL_CLOSE };
      const names1 = await namesAt(FIRST_TIME, options);
      const names2 = await namesAt(FIRST_TIME + CLOCK_STEP_MS, options);

      expect(names1).toHaveLength(4);
      expect(names1).toEqual(names2);
    });

    it("should produce same file names for a text font across builds", async () => {
      const options = {
        fixture: fixtures["subset-chars"].path,
        pluginOptions: { type: "manual", targets: [] } satisfies PluginOption,
      };
      const names1 = await namesAt(FIRST_TIME, options);
      const names2 = await namesAt(FIRST_TIME + CLOCK_STEP_MS, options);

      expect(names1).toHaveLength(2);
      expect(names1).toEqual(names2);
    });

    it("should produce different file names when ligatures change", async () => {
      const build1 = await buildFixture({
        fixture: fixtures.plain.path,
        pluginOptions: MANUAL_CLOSE,
      });
      const build2 = await buildFixture({
        fixture: fixtures.plain.path,
        pluginOptions: {
          type: "manual",
          targets: [{ fontName: "Font Name", ligatures: ["close", "play_arrow"] }],
        },
      });

      const names1 = getFontFileNames(build1.output as OutputAsset[]);
      const names2 = getFontFileNames(build2.output as OutputAsset[]);

      expect(names1.length).toBeGreaterThan(0);
      expect(names1).not.toEqual(names2);
    });
  });

  describe("auto mode", () => {
    it("should produce same file names for same icons across builds", async () => {
      const options = {
        fixture: fixtures["auto-one-icon"].path,
        pluginOptions: { type: "auto" } satisfies PluginOption,
      };
      const names1 = await namesAt(FIRST_TIME, options);
      const names2 = await namesAt(FIRST_TIME + CLOCK_STEP_MS, options);

      expect(names1.length).toBeGreaterThan(0);
      expect(names1).toEqual(names2);
    });

    it("should produce different file names when icon count changes", async () => {
      const build1 = await buildFixture({
        fixture: fixtures["auto-one-icon"].path,
        pluginOptions: { type: "auto" },
      });
      const build2 = await buildFixture({
        fixture: fixtures["auto-two-icons"].path,
        pluginOptions: { type: "auto" },
      });

      const names1 = getFontFileNames(build1.output as OutputAsset[]);
      const names2 = getFontFileNames(build2.output as OutputAsset[]);

      expect(names1.length).toBeGreaterThan(0);
      expect(names2.length).toBeGreaterThan(0);
      expect(names1).not.toEqual(names2);
    });
  });
});
