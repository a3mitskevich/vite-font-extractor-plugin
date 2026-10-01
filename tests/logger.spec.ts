import { describe, it, expect, beforeEach } from "vitest";
import type { Logger } from "vite";
import { createInternalLogger } from "../src/internal-logger";
import type { InternalLogger } from "../src/types";

interface CapturedMessage {
  type: "info" | "warn" | "error";
  message: string;
}

function createTestLogger(): { logger: InternalLogger; messages: CapturedMessage[] } {
  const messages: CapturedMessage[] = [];
  const customLogger = new Proxy(
    {},
    {
      get(_: any, key: any): any {
        if (key === "clearScreen" || key === "hasErrorLogged" || key === "hasWarned")
          return () => false;
        return (message: string) => {
          messages.push({ type: key, message });
        };
      },
    },
  ) as Logger;

  const logger = createInternalLogger("info", customLogger);
  return { logger, messages };
}

describe("InternalLogger", () => {
  let logger: InternalLogger;
  let messages: CapturedMessage[];

  beforeEach(() => {
    const test = createTestLogger();
    logger = test.logger;
    messages = test.messages;
  });

  describe("banner()", () => {
    it("should output plugin name", () => {
      logger.banner();
      const hasBanner = messages.some(
        (m) => m.type === "info" && m.message.includes("vite-font-extractor-plugin"),
      );
      expect(hasBanner).toBeTruthy();
    });
  });

  describe("config()", () => {
    it("should output mode and details", () => {
      logger.config("manual", "1 target, cache enabled");
      const hasConfig = messages.some(
        (m) =>
          m.type === "info" &&
          m.message.includes("Config") &&
          m.message.includes("manual") &&
          m.message.includes("cache enabled"),
      );
      expect(hasConfig).toBeTruthy();
    });
  });

  describe("phase()", () => {
    it("should output phase name with icon", () => {
      logger.phase("✂ ", "Minify");
      const hasPhase = messages.some((m) => m.type === "info" && m.message.includes("Minify"));
      expect(hasPhase).toBeTruthy();
    });
  });

  describe("found()", () => {
    it("should output font type and name", () => {
      logger.found("Font", "Material Icons", "4 formats");
      const hasFound = messages.some(
        (m) =>
          m.type === "info" &&
          m.message.includes("Font") &&
          m.message.includes("Material Icons") &&
          m.message.includes("4 formats"),
      );
      expect(hasFound).toBeTruthy();
    });

    it("should work without detail", () => {
      logger.found("@font-face", "Roboto");
      const hasFound = messages.some((m) => m.type === "info" && m.message.includes("Roboto"));
      expect(hasFound).toBeTruthy();
    });
  });

  describe("minified()", () => {
    it("should show extension, sizes, bar and reduction", () => {
      logger.minified("Material Icons", "woff2", 124_404, 1_400);
      const msg = messages.find((m) => m.type === "info" && m.message.includes(".woff2"));
      expect(msg).toBeTruthy();
      expect(msg!.message).toContain("121.5 KB");
      expect(msg!.message).toContain("1.4 KB");
      expect(msg!.message).toContain("-99%");
      expect(msg!.message).toContain("█");
    });

    it("should use └─ for last item", () => {
      logger.minified("Font", "ttf", 100_000, 5_000, true);
      const msg = messages.find((m) => m.type === "info" && m.message.includes(".ttf"));
      expect(msg).toBeTruthy();
      expect(msg!.message).toContain("└─");
    });

    it("should use ├─ for non-last item", () => {
      logger.minified("Font", "woff", 100_000, 5_000, false);
      const msg = messages.find((m) => m.type === "info" && m.message.includes(".woff"));
      expect(msg).toBeTruthy();
      expect(msg!.message).toContain("├─");
    });
  });

  describe("cached()", () => {
    it("should show cached font name", () => {
      logger.cached("Material Icons");
      const hasCached = messages.some(
        (m) =>
          m.type === "info" && m.message.includes("cached") && m.message.includes("Material Icons"),
      );
      expect(hasCached).toBeTruthy();
    });
  });

  describe("skipped()", () => {
    it("should show font name and reason", () => {
      logger.skipped("Arial", "not smaller than original");
      const hasSkipped = messages.some(
        (m) =>
          m.type === "info" && m.message.includes("Arial") && m.message.includes("not smaller"),
      );
      expect(hasSkipped).toBeTruthy();
    });
  });

  describe("summary()", () => {
    it("should show minified count and saved size", () => {
      logger.summary({ minified: 6, cached: 2, saved: 482_000 });
      const hasSummary = messages.some(
        (m) =>
          m.type === "info" &&
          m.message.includes("Done") &&
          m.message.includes("6 fonts minified") &&
          m.message.includes("2 cached") &&
          m.message.includes("470.7 KB saved"),
      );
      expect(hasSummary).toBeTruthy();
    });

    it("should omit zero stats", () => {
      logger.summary({ minified: 3, cached: 0, saved: 100_000 });
      const msg = messages.find((m) => m.type === "info" && m.message.includes("Done"));
      expect(msg).toBeTruthy();
      expect(msg!.message).toContain("3 fonts minified");
      expect(msg!.message).not.toContain("cached");
    });
  });

  describe("warn()", () => {
    it("should output warning with icon", () => {
      logger.warn("Something is wrong");
      const hasWarn = messages.some(
        (m) => m.type === "warn" && m.message.includes("Something is wrong"),
      );
      expect(hasWarn).toBeTruthy();
    });
  });

  describe("error()", () => {
    it("should output error with icon", () => {
      logger.error("Fatal problem");
      const hasError = messages.some(
        (m) => m.type === "error" && m.message.includes("Fatal problem"),
      );
      expect(hasError).toBeTruthy();
    });
  });

  describe("fix()", () => {
    it("should add empty line before next log", () => {
      logger.fix();
      logger.info("after fix");
      // First message is empty line, second is actual
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[0].message).toBe("");
    });
  });

  describe("full build simulation", () => {
    it("should produce readable output", () => {
      logger.banner();
      logger.config("manual", "2 targets, cache enabled");

      logger.phase("✂ ", "Minify");

      logger.found("Font", "Material Icons", "4 formats");
      logger.minified("Material Icons", "eot", 142_571, 3_200);
      logger.minified("Material Icons", "woff2", 124_404, 1_400);
      logger.minified("Material Icons", "woff", 159_604, 1_900);
      logger.minified("Material Icons", "ttf", 345_452, 3_000, true);

      logger.found("Font", "Roboto Subset", "2 formats");
      logger.minified("Roboto Subset", "woff2", 21_884, 10_440);
      logger.minified("Roboto Subset", "woff", 21_776, 8_610, true);

      logger.cached("Press Start 2P");

      logger.summary({ minified: 6, cached: 1, saved: 793_247 });

      // Print to console for visual inspection (visible with --reporter=verbose)
      console.log("\n--- Logger output preview ---");
      for (const m of messages) {
        if (m.message) console.log(m.message);
      }
      console.log("--- End preview ---\n");

      // Verify structure
      expect(messages.length).toBeGreaterThan(10);
      const hasAllParts = [
        "vite-font-extractor-plugin",
        "Config",
        "Minify",
        "Material Icons",
        "Roboto Subset",
        "cached",
        "Done",
      ].every((text) => messages.some((m) => m.message.includes(text)));
      expect(hasAllParts).toBeTruthy();
    });
  });
});
