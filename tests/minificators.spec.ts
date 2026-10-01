import { describe, it, expect } from "vitest";
import { buildFixture, type BuildOptions, type CssMinify, fixtures } from "./utils";

describe("Minificators", () => {
  describe(`External url sources`, () => {
    Array.from(["lightningcss", "esbuild"] as CssMinify[]).forEach((cssMinify) => {
      describe(`Css minificator is ${cssMinify}`, () => {
        describe("Has an url in sources", () => {
          const fixture = fixtures["font-family-resource-is-url"];

          const build = async (options?: BuildOptions) =>
            buildFixture({
              ...options,
              cssMinify,
              fixture: fixture.path,
              targets: fixture.fonts.map((font) => font.name),
            });

          it("should log warn about expected font has an url source", async () => {
            const { messages } = await build();

            const hasError = messages.some(
              ({ message, type }) =>
                message.includes("has external url sources:") && type === "warn",
            );
            expect(hasError).toBeTruthy();
          });
        });
      });
    });
  });
});
