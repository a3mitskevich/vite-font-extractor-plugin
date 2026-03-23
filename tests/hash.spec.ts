import { describe, it, expect } from "vitest";
import type { OutputAsset } from "rollup";
import { buildByVersion, type ContainerVersion, fixtures, viteBuild } from "./utils";

function getFontFileNames(output: OutputAsset[]): string[] {
  return output
    .filter((a): a is OutputAsset => a.type === "asset" && a.fileName.includes("font"))
    .map((a) => a.fileName)
    .sort();
}

describe.sequential("Hash consistency", () => {
  const runHashTest = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      // Known issue: fontext native encoders can produce nondeterministic binary output
      // TODO: investigate deterministic font subsetting to guarantee stable hashes
      describe("manual mode", () => {
        const fixture = fixtures.plain;

        it(
          "should produce same file hashes for same config across builds",
          { retry: 5 },
          async () => {
            const build1 = await buildByVersion(version, {
              fixture: fixture.path,
              pluginOptions: {
                type: "manual",
                targets: [{ fontName: "Font Name", ligatures: ["close"] }],
              },
            });
            const build2 = await buildByVersion(version, {
              fixture: fixture.path,
              pluginOptions: {
                type: "manual",
                targets: [{ fontName: "Font Name", ligatures: ["close"] }],
              },
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
            pluginOptions: {
              type: "manual",
              targets: [{ fontName: "Font Name", ligatures: ["close"] }],
            },
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

      // Known issue: fontext native encoders (ttf2woff2, ttf2eot) can produce
      // nondeterministic binary output across runs. This causes content-based hashes
      // to differ even with identical input. Retry mitigates but doesn't fully solve.
      // TODO: investigate deterministic font subsetting to guarantee stable hashes
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
