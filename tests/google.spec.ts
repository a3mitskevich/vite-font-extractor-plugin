import { describe, it, expect } from "vitest";
import type { OutputAsset } from "rollup";
import { join } from "node:path";
import { buildFixture, type BuildOptions, type CssMinify, fixtures, fixturesDir } from "./utils";

describe("Google", () => {
  describe(`Google font test`, () => {
    Array.from(["lightningcss", "esbuild"] as CssMinify[]).forEach((cssMinify) => {
      describe(`Css minificator is ${cssMinify}`, () => {
        describe("Build test", () => {
          const fixture = fixtures["google-font"];
          const build = async (options?: BuildOptions) =>
            buildFixture({
              ...options,
              cssMinify,
              fixture: fixture.path,
              targets: fixture.fonts.map((font) => font.name),
            });

          it("should return fixed urls", async () => {
            const { output } = await build();
            const targets = output
              .filter(
                (asset): asset is OutputAsset =>
                  asset.type === "asset" &&
                  typeof asset.source === "string" &&
                  asset.source.includes("fonts.googleapis.com"),
              )
              .map<string>((asset) => asset.source.toString());

            expect(targets).toHaveLength(2);
            targets.forEach((content) => {
              expect(content).toContain("&text=close+play_arrow");
            });
          });
        });

        describe("Multi-family URL", () => {
          const fixture = fixtures["google-font-multi"];
          const build = async (options?: BuildOptions) =>
            buildFixture({
              ...options,
              cssMinify,
              fixture: fixture.path,
              pluginOptions: {
                type: "manual",
                targets: fixture.fonts.map((font) => ({
                  fontName: font.name,
                  ligatures: ["close", "play_arrow"],
                })),
              },
            });

          it("should handle pipe-separated families in Google Font URL", async () => {
            const { output } = await build();
            const targets = output
              .filter(
                (asset): asset is OutputAsset =>
                  asset.type === "asset" &&
                  typeof asset.source === "string" &&
                  asset.source.includes("fonts.googleapis.com"),
              )
              .map<string>((asset) => asset.source.toString());

            expect(targets).toHaveLength(2);
            targets.forEach((content) => {
              expect(content).toContain("&text=close+play_arrow");
            });
          });
        });

        describe("Duplication minification logic", () => {
          const fixture = fixtures["google-font-warn"];
          const build = async (options?: BuildOptions) =>
            buildFixture({
              ...options,
              cssMinify,
              fixture: fixture.path,
              targets: fixture.fonts.map((font) => font.name),
            });

          it("should warn message if original url has text option", async () => {
            const { messages, output } = await build();

            const hasWarning = messages.some(
              ({ message, type }) =>
                message.includes("has duplicated logic for minification") && type === "warn",
            );
            expect(hasWarning).toBeTruthy();

            const targets = output
              .filter(
                (asset): asset is OutputAsset =>
                  asset.type === "asset" &&
                  typeof asset.source === "string" &&
                  asset.source.includes("fonts.googleapis.com"),
              )
              .map<string>((asset) => asset.source.toString());

            expect(targets).toHaveLength(2);
            targets.forEach((content) => {
              expect(content).toContain("&text=duplicate+close+play_arrow");
            });
          });
        });
      });
    });
  });
});

const googleSources = (output: unknown[]): string[] =>
  (output as OutputAsset[])
    .filter(
      (asset) =>
        asset.type === "asset" &&
        typeof asset.source === "string" &&
        asset.source.includes("fonts.googleapis.com"),
    )
    .map((asset) => String(asset.source));

describe("Google Fonts text=", () => {
  it("should add the characters of a subset target", async () => {
    const { output } = await buildFixture({
      fixture: fixtures["google-font"].path,
      pluginOptions: {
        type: "manual",
        targets: ["Index", "Css font"].map((fontName) => ({
          fontName,
          engine: "subset" as const,
          characters: "ABC",
        })),
      },
    });

    const sources = googleSources(output);
    expect(sources).toHaveLength(2);
    sources.forEach((content) => expect(content).toContain("&text=ABC"));
  });

  it("should add the glyphs found in auto mode", async () => {
    const { output } = await buildFixture({
      fixture: join(fixturesDir, "google-font-auto"),
      pluginOptions: { type: "auto" },
    });

    const sources = googleSources(output);
    expect(sources).toHaveLength(2);
    sources.forEach((content) => expect(content).toContain("&text=home"));
  });
});
