import { describe, it, expect } from "vitest";
import { buildByVersion, type ContainerVersion, fixtures, viteBuild } from "./utils";

describe.sequential("Error handling", () => {
  const runErrorTest = (version: ContainerVersion) => {
    describe(`vite@${version}`, () => {
      it("should warn when font has no minify options in manual mode", async () => {
        const { messages } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          pluginOptions: {
            type: "manual",
            targets: [{ fontName: "Non Existent Font", ligatures: ["close"] }],
          },
        });

        const hasNoOptionsWarn = messages.some(
          (m) => m.type === "warn" && m.message.includes("has no minify options"),
        );
        expect(hasNoOptionsWarn).toBeTruthy();
      });

      it("should warn when font has external URL sources", async () => {
        const { messages } = await buildByVersion(version, {
          fixture: fixtures["font-family-resource-is-url"].path,
          targets: fixtures["font-family-resource-is-url"].fonts.map((f) => f.name),
        });

        const hasExternalUrlWarn = messages.some(
          (m) => m.type === "warn" && m.message.includes("has external url sources"),
        );
        expect(hasExternalUrlWarn).toBeTruthy();
      });

      it("should not produce errors for valid configuration", async () => {
        const { messages } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          targets: fixtures.plain.fonts.map((f) => f.name),
        });

        const hasError = messages.some((m) => m.type === "error");
        expect(hasError).toBeFalsy();
      });

      it("should build successfully with no matching fonts", async () => {
        const { output, messages } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          pluginOptions: {
            type: "manual",
            targets: [],
          },
        });

        const hasError = messages.some((m) => m.type === "error");
        expect(hasError).toBeFalsy();
        expect(output.length).toBeGreaterThan(0);
      });

      it("should warn when ignore option overlaps with targets", async () => {
        const { messages } = await buildByVersion(version, {
          fixture: fixtures.plain.path,
          pluginOptions: {
            type: "manual",
            targets: [{ fontName: "Font Name", ligatures: ["close"] }],
            ignore: ["Font Name"],
          },
        });

        const hasIntersectionWarn = messages.some(
          (m) => m.type === "warn" && m.message.includes("intersection with targets"),
        );
        expect(hasIntersectionWarn).toBeTruthy();
      });
    });
  };

  Object.keys(viteBuild).forEach((version) => {
    runErrorTest(version);
  });
});
