import { describe, it, expect } from "vitest";
import {
  buildByVersion,
  type BuildOptions,
  type ContainerVersion,
  type CssMinify,
  fixtures,
  type FixturesNames,
  viteBuild,
} from "./utils";

describe("Common", () => {
  const runCommonTest = (version: ContainerVersion, fixturesNames: FixturesNames) => {
    describe(`Common test for vite@${version}`, () => {
      fixturesNames.forEach((fixtureName) => {
        const fixture = fixtures[fixtureName];
        Array.from(["lightningcss", "esbuild"] as CssMinify[]).forEach((cssMinify) => {
          describe(`Build test for "${fixtureName}" fixture with "${cssMinify}" css minificator`, () => {
            const build = async (options?: BuildOptions) =>
              buildByVersion(version, {
                ...options,
                fixture: fixture.path,
                targets: fixture.fonts.map((font) => font.name),
              });

            it("should correct log", async () => {
              const { messages } = await build();
              const hasDoneMessage = messages.some(
                ({ message, type }) => message.includes("Done") && type === "info",
              );
              const hasMinifyPhase = messages.some(
                ({ message, type }) => message.includes("Minify") && type === "info",
              );
              const hasErrorMessages = messages.some(({ type }) => type === "error");
              expect(hasErrorMessages).toBeFalsy();
              expect(hasDoneMessage).toBeTruthy();
              expect(hasMinifyPhase).toBeTruthy();
            });

            it("should not contain cache messages when disabled", async () => {
              const { messages } = await build({ cache: false });
              const hasCachedMessage = messages.some(
                ({ message, type }) => message.includes("cached") && type === "info",
              );
              expect(hasCachedMessage).toBeFalsy();
            });
          });
        });
      });
    });
  };

  const runAllTests = () => {
    Object.keys(viteBuild).forEach((version) => {
      runCommonTest(version, ["plain", "plain-html", "mixins", "import-css", "import-js"]);
    });
  };

  runAllTests();
  // runCommonTest(versionV4, ['plain-html']) // for single debug
});
