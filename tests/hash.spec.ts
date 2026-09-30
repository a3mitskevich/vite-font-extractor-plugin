import { describe, it, expect, vi, afterEach } from "vitest";
import type { OutputAsset } from "rollup";
import type { PluginOption } from "../src";
import {
  buildByVersion,
  type ContainerVersion,
  fixtures,
  getFontAssets,
  type OutputItem,
  viteBuild,
} from "./utils";

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

// 2020-01-01T00:00:00Z; svg2ttf stores timestamps with one second resolution
const FROZEN_TIME = 1_577_836_800_000;
const CLOCK_STEP_MS = 2_000;

const SFNT_NUM_TABLES_OFFSET = 4;
const SFNT_DIRECTORY_OFFSET = 12;
const SFNT_DIRECTORY_ENTRY_SIZE = 16;

interface ByteRange {
  start: number;
  end: number;
}

// Byte ranges of the `head` table and of its checksum in the table directory
const getHeadTableRanges = (ttf: Buffer): ByteRange[] => {
  const numTables = ttf.readUInt16BE(SFNT_NUM_TABLES_OFFSET);
  for (let i = 0; i < numTables; i++) {
    const entry = SFNT_DIRECTORY_OFFSET + i * SFNT_DIRECTORY_ENTRY_SIZE;
    if (ttf.toString("ascii", entry, entry + 4) !== "head") continue;
    const offset = ttf.readUInt32BE(entry + 8);
    const length = ttf.readUInt32BE(entry + 12);
    return [
      { start: entry + 4, end: entry + 8 },
      { start: offset, end: offset + length },
    ];
  }
  throw new Error("head table not found");
};

const getDifferentOffsets = (a: Buffer, b: Buffer): number[] =>
  Array.from(a.keys()).filter((index) => a[index] !== b[index]);

describe.sequential("Hash consistency", () => {
  const runHashTest = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      // Known issue (ROADMAP.md → "Deterministic font hashing"): fontext builds fonts through
      // svg2ttf, which writes the current time (1 s resolution) into head.created/modified.
      // Two builds in different seconds produce different bytes and hashes, so the real-clock
      // tests below retry; the frozen-clock tests pin the cause down without retries.
      describe("manual mode", () => {
        const fixture = fixtures.plain;

        it(
          "should produce same file hashes for same config across builds",
          { retry: 5 },
          async () => {
            const build1 = await buildByVersion(version, {
              fixture: fixture.path,
              pluginOptions: MANUAL_CLOSE,
            });
            const build2 = await buildByVersion(version, {
              fixture: fixture.path,
              pluginOptions: MANUAL_CLOSE,
            });

            const names1 = getFontFileNames(build1.output as OutputAsset[]);
            const names2 = getFontFileNames(build2.output as OutputAsset[]);

            expect(names1.length).toBeGreaterThan(0);
            expect(names1).toEqual(names2);
          },
        );

        it("should produce different file hashes when ligatures change", async () => {
          const build1 = await buildByVersion(version, {
            fixture: fixture.path,
            pluginOptions: MANUAL_CLOSE,
          });
          const build2 = await buildByVersion(version, {
            fixture: fixture.path,
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

      describe("frozen clock", () => {
        afterEach(() => {
          vi.useRealTimers();
        });

        const buildAt = async (time: number) => {
          vi.useFakeTimers({ toFake: ["Date"], now: time });
          try {
            const { output } = await buildByVersion(version, {
              fixture: fixtures.plain.path,
              pluginOptions: MANUAL_CLOSE,
            });
            return output as OutputItem[];
          } finally {
            vi.useRealTimers();
          }
        };

        const getTtf = (output: OutputItem[]): Buffer => {
          const ttf = getFontAssets(output).find((asset) => asset.fileName.endsWith(".ttf"));
          if (!ttf) throw new Error("ttf asset not found");
          return Buffer.from(ttf.source);
        };

        it("should produce identical fonts when the clock does not move", async () => {
          const names1 = getFontFileNames((await buildAt(FROZEN_TIME)) as OutputAsset[]);
          const names2 = getFontFileNames((await buildAt(FROZEN_TIME)) as OutputAsset[]);

          expect(names1).toHaveLength(4);
          expect(names1).toEqual(names2);
        });

        it("should differ only in the head table timestamps when the clock moves", async () => {
          const before = await buildAt(FROZEN_TIME);
          const after = await buildAt(FROZEN_TIME + CLOCK_STEP_MS);

          // Every format hashes differently...
          const namesBefore = getFontFileNames(before as OutputAsset[]);
          const namesAfter = getFontFileNames(after as OutputAsset[]);
          expect(namesBefore).toHaveLength(4);
          namesBefore.forEach((name) => expect(namesAfter).not.toContain(name));

          // ...although the TTF they are built from changes only inside `head`
          const ttfBefore = getTtf(before);
          const ttfAfter = getTtf(after);
          expect(ttfAfter.length).toBe(ttfBefore.length);
          const headRanges = getHeadTableRanges(ttfBefore);
          const offsets = getDifferentOffsets(ttfBefore, ttfAfter);
          expect(offsets.length).toBeGreaterThan(0);
          offsets.forEach((offset) => {
            const inHead = headRanges.some(({ start, end }) => offset >= start && offset < end);
            expect(inHead, `byte ${offset} outside of head`).toBe(true);
          });
        });
      });

      // Same known issue as above (ROADMAP.md → "Deterministic font hashing")
      describe("auto mode", () => {
        it(
          "should produce same file hashes for same icons across builds",
          { retry: 5 },
          async () => {
            const build1 = await buildByVersion(version, {
              fixture: fixtures["auto-one-icon"].path,
              pluginOptions: { type: "auto" },
            });
            const build2 = await buildByVersion(version, {
              fixture: fixtures["auto-one-icon"].path,
              pluginOptions: { type: "auto" },
            });

            const names1 = getFontFileNames(build1.output as OutputAsset[]);
            const names2 = getFontFileNames(build2.output as OutputAsset[]);

            expect(names1.length).toBeGreaterThan(0);
            expect(names1).toEqual(names2);
          },
        );

        it("should produce different file hashes when icon count changes", async () => {
          const build1 = await buildByVersion(version, {
            fixture: fixtures["auto-one-icon"].path,
            pluginOptions: { type: "auto" },
          });
          const build2 = await buildByVersion(version, {
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
  };

  Object.keys(viteBuild).forEach((version) => {
    runHashTest(version);
  });
});
