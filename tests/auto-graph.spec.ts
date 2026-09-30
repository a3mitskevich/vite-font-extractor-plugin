import { describe, it, expect } from "vitest";
import { join } from "node:path";
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
  type Plugin,
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

const lateFixture = createFixture("auto-late-chunk", { fonts: [] });
const LATE_CHUNK_ID = "\0late-chunk";

// A chunk another plugin emits is not part of the graph until it loads; here it loads after the
// font of first.css is emitted and imports `stylesheets`
const emitLateChunk = (stylesheets: string[]): Plugin[] => {
  let openGate = (): void => {};
  const firstFontEmitted = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  return [
    {
      name: "late-chunk",
      buildStart() {
        this.emitFile({ type: "chunk", id: LATE_CHUNK_ID });
      },
      resolveId: (id) => (id === LATE_CHUNK_ID ? id : null),
      async load(id) {
        if (id !== LATE_CHUNK_ID) return null;
        await firstFontEmitted;
        return stylesheets
          .map((file) => `import ${JSON.stringify(join(lateFixture.path, file))};`)
          .join("\n");
      },
    },
    {
      name: "late-chunk-gate",
      enforce: "post",
      transform(_, id) {
        if (id.endsWith("first.css")) openGate();
        return null;
      },
    },
  ];
};

const LATE_GLYPH_ERROR = /CSS content "menu" was found after its font had been emitted/;

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

  it("fails the build when a glyph is found after its font was emitted", async () => {
    await expect(
      buildFixture({
        fixture: lateFixture.path,
        pluginOptions: { type: "auto" },
        config: { plugins: emitLateChunk(["late.css"]) },
      }),
    ).rejects.toThrow(LATE_GLYPH_ERROR);
  });

  // The second font is minified with the late glyph; the first one still lacks it
  it("fails the build when only a font minified later has the late glyph", async () => {
    await expect(
      buildFixture({
        fixture: lateFixture.path,
        pluginOptions: { type: "auto" },
        config: { plugins: emitLateChunk(["late.css", "second.css"]) },
      }),
    ).rejects.toThrow(LATE_GLYPH_ERROR);
  });
});
