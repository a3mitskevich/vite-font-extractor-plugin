import { describe, it, expect } from "vitest";
import {
  buildFixture,
  createFixture,
  findBrokenFontReferences,
  findOrphanFontAssets,
  fontsLength,
  getReadableFontAssets,
  type LoggerMessage,
  openFont,
  type OutputItem,
  rendersLigature,
} from "./utils";

const fixture = createFixture("auto-graph", { fonts: [] });

const problems = (messages: LoggerMessage[]) => messages.filter((m) => m.type === "error");

const LATE_CSS_DELAY_MS = 500;

// The CSS of the deepest lazy chunk is transformed well after the @font-face module
const delayLateCss = {
  name: "delay-late-css",
  enforce: "pre" as const,
  async transform(_: string, id: string) {
    if (id.endsWith("menu.scss")) {
      await new Promise((resolve) => {
        setTimeout(resolve, LATE_CSS_DELAY_MS);
      });
    }
    return null;
  },
};

describe("Auto mode: glyphs of the whole module graph", () => {
  // The @font-face module is transformed before the CSS of lazy chunks; the font waits for them
  it("keeps the glyphs of every stylesheet, lazy chunks, Sass variables and CSS modules included", async () => {
    const { output, messages } = await buildFixture({
      fixture: fixture.path,
      pluginOptions: { type: "auto" },
      config: { plugins: [delayLateCss] },
    });
    const items = output as OutputItem[];

    expect(problems(messages)).toEqual([]);
    expect(findBrokenFontReferences(items)).toEqual([]);
    expect(findOrphanFontAssets(items)).toEqual([]);
    const fonts = getReadableFontAssets(items);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].source.length).toBeLessThan(fontsLength.woff2);
    const font = openFont(fonts[0].source);
    for (const icon of ["home", "search", "close", "menu"]) {
      expect(rendersLigature(font, icon), icon).toBe(true);
    }
    expect(rendersLigature(font, "star")).toBe(false);
  });

  it("skips emoji and non-BMP code points the font does not have", async () => {
    const { messages } = await buildFixture({
      fixture: fixture.path,
      pluginOptions: { type: "auto" },
    });

    const skipped = messages.find((m) => m.message.includes("not found in the font"));
    expect(skipped?.type).toBe("info");
    expect(skipped?.message).toContain("U+1F600");
    expect(skipped?.message).toContain("U+1F3B5");
  });
});
