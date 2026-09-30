import { describe, it, expect } from "vitest";
import type { FontFaceInfo, PluginOption, Target } from "../src";
import {
  buildFixture,
  findBrokenFontReferences,
  fixtures,
  fontsLength,
  getFontAssets,
  getReadableFontAssets,
  hasGlyph,
  openFont,
  type OutputAsset,
  type OutputItem,
  plugin,
  rendersLigature,
} from "./utils";

const CLOSE_CODE_POINT = 0xe5cd;
const PLAY_ARROW_CODE_POINT = 0xe037;

const build = async (pluginOptions: PluginOption, fixture = fixtures.plain.path) => {
  const { output, messages } = await buildFixture({ fixture, pluginOptions });
  const items = output as OutputItem[];
  expect(findBrokenFontReferences(items)).toEqual([]);
  return { items, messages };
};

const sizeOf = (asset: OutputAsset): number => Buffer.from(asset.source).length;
const extensionOf = (asset: OutputAsset) =>
  asset.fileName.split(".").pop() as keyof typeof fontsLength;

const expectOriginals = (items: OutputItem[]): void => {
  const fonts = getFontAssets(items);
  expect(fonts.length).toBeGreaterThan(0);
  fonts.forEach((asset) =>
    expect(sizeOf(asset), asset.fileName).toBe(fontsLength[extensionOf(asset)]),
  );
};

// Every readable format is minified and keeps `close`, and only it
const expectCloseOnly = (items: OutputItem[]): void => {
  const fonts = getReadableFontAssets(items);
  expect(fonts.length).toBeGreaterThan(0);
  fonts.forEach((asset) => {
    expect(sizeOf(asset), asset.fileName).toBeLessThan(fontsLength[extensionOf(asset)]);
    const font = openFont(asset.source);
    expect(hasGlyph(font, CLOSE_CODE_POINT), asset.fileName).toBe(true);
    expect(hasGlyph(font, PLAY_ARROW_CODE_POINT), asset.fileName).toBe(false);
  });
};

const fontFileNames = (items: OutputItem[]): string[] =>
  getFontAssets(items)
    .map((asset) => asset.fileName)
    .sort();

describe("Target match", () => {
  const matchers: Array<[string, Target["match"]]> = [
    ["a family name", "Font Name"],
    ["a RegExp", /^font name$/i],
    ["a function of the face", (face) => face.urls.some((url) => url.includes("icon-font"))],
  ];
  it.each(matchers)("should minify the faces %s matches", async (_, match) => {
    const { items, messages } = await build({
      type: "manual",
      targets: [{ fontName: "Icons", match, ligatures: ["close"] }],
    });
    expectCloseOnly(items);
    const woff2 = getFontAssets(items).find((asset) => asset.fileName.endsWith(".woff2"))!;
    expect(rendersLigature(openFont(woff2.source), "close")).toBe(true);
    expect(messages.filter((m) => m.type === "warn" || m.type === "error")).toEqual([]);
  });

  it("should give a face the first matching target", async () => {
    const { items } = await build({
      type: "manual",
      targets: [
        { fontName: "First", match: /Font/, ligatures: ["close"] },
        { fontName: "Font Name", ligatures: ["play_arrow"] },
      ],
    });
    expectCloseOnly(items);
  });

  it("should name the output after the result, not after the matcher", async () => {
    const withFunction: PluginOption = {
      type: "manual",
      targets: [
        {
          fontName: "Font Name",
          match: (face) => face.family === "Font Name",
          ligatures: ["close"],
        },
      ],
    };
    const first = await build(withFunction);
    const second = await build(withFunction);
    const plain = await build({
      type: "manual",
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
    });

    // Same input, same names: a function matcher does not make the build unstable
    expect(fontFileNames(second.items)).toEqual(fontFileNames(first.items));
    // `match` is not an option of the minification: the plain target gives the same files
    expect(fontFileNames(plain.items)).toEqual(fontFileNames(first.items));
  });
});

describe("ignore matchers", () => {
  const ignores: Array<[string, PluginOption["ignore"]]> = [
    ["a RegExp", [/^Font/]],
    ["a function", [(face: FontFaceInfo) => face.urls.some((url) => url.endsWith(".woff2"))]],
  ];
  it.each(ignores)("should keep the faces %s ignores original", async (_, ignore) => {
    const { items } = await build({
      type: "manual",
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
      ignore,
    });
    expectOriginals(items);
  });
});

describe("resolveTarget", () => {
  it("should minify a face with the target it returns", async () => {
    const { items, messages } = await build({
      type: "manual",
      targets: [],
      resolveTarget: (face) => ({ fontName: face.family, ligatures: ["close"] }),
    });
    expectCloseOnly(items);
    expect(messages.filter((m) => m.type === "warn")).toEqual([]);
  });

  it("should get the configured target and keep it on undefined", async () => {
    const target: Target = { fontName: "Font Name", ligatures: ["close"] };
    const seen: Array<{ face: FontFaceInfo; resolved: Target | null }> = [];
    const { items } = await build({
      type: "manual",
      targets: [target],
      resolveTarget: (face, resolved) => {
        seen.push({ face, resolved });
        return undefined;
      },
    });
    expectCloseOnly(items);
    expect(seen.length).toBeGreaterThan(0);
    for (const { face, resolved } of seen) {
      expect(resolved).toBe(target);
      expect(face.family).toBe("Font Name");
      expect(face.id).toMatch(/plain\.css$/);
      expect(face.urls.some((url) => url.includes("icon-font.woff2"))).toBe(true);
    }
  });

  it("should leave a face alone on null, without a warning", async () => {
    const { items, messages } = await build({
      type: "manual",
      targets: [{ fontName: "Font Name", ligatures: ["close"] }],
      resolveTarget: () => null,
    });
    expectOriginals(items);
    expect(messages.filter((m) => m.type === "warn" || m.type === "error")).toEqual([]);
  });

  it("should fail the build for a target without fontName", async () => {
    await expect(
      build({
        type: "manual",
        targets: [],
        resolveTarget: () => ({ ligatures: ["close"] }) as unknown as Target,
      }),
    ).rejects.toThrow(/resolveTarget for "Font Name": a target needs a `fontName` string/);
  });

  describe("auto mode", () => {
    it("should keep auto glyphs on undefined, with no configured target", async () => {
      const resolved: Array<Target | null> = [];
      const { items } = await build(
        {
          type: "auto",
          resolveTarget: (_, target) => {
            resolved.push(target);
            return undefined;
          },
        },
        fixtures.auto.path,
      );
      expectCloseOnly(items);
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved.every((target) => target === null)).toBe(true);
    });

    it("should minify with the target it returns instead of auto glyphs", async () => {
      const { items } = await build(
        {
          type: "auto",
          resolveTarget: (face) => ({ fontName: face.family, ligatures: ["play_arrow"] }),
        },
        fixtures.auto.path,
      );
      const fonts = getReadableFontAssets(items);
      expect(fonts.length).toBeGreaterThan(0);
      fonts.forEach((asset) => {
        const font = openFont(asset.source);
        expect(hasGlyph(font, PLAY_ARROW_CODE_POINT), asset.fileName).toBe(true);
        expect(hasGlyph(font, CLOSE_CODE_POINT), asset.fileName).toBe(false);
      });
    });

    it("should keep a face original on null", async () => {
      const { items } = await build(
        { type: "auto", resolveTarget: () => null },
        fixtures.auto.path,
      );
      expectOriginals(items);
    });
  });

  it("should decide the families of a Google Fonts url", async () => {
    const seen: FontFaceInfo[] = [];
    const { items } = await build(
      {
        type: "manual",
        targets: [],
        resolveTarget: (face) => {
          seen.push(face);
          return face.family === "Index" ? { fontName: "Index", ligatures: ["home"] } : null;
        },
      },
      fixtures["google-font"].path,
    );
    const html = items.find((item): item is OutputAsset => item.fileName === "index.html")!;
    expect(String(html.source)).toContain("family=Index&text=home");
    const css = items.find(
      (item): item is OutputAsset => item.type === "asset" && item.fileName.endsWith(".css"),
    );
    expect(String(css?.source ?? "")).not.toContain("text=");

    const index = seen.find((face) => face.family === "Index")!;
    expect(index.id).toBe("");
    expect(index.urls).toEqual(["https://fonts.googleapis.com/icon?family=Index"]);
    const cssFont = seen.find((face) => face.family === "Css font")!;
    expect(cssFont.id).toMatch(/index\.css$/);
  });
});

describe("Target validation", () => {
  it("should reject two targets with one fontName", async () => {
    await expect(
      plugin({
        type: "manual",
        targets: [
          { fontName: "Icons", ligatures: ["close"] },
          { fontName: "Icons", match: /Outlined/, ligatures: ["close"] },
        ],
      }),
    ).rejects.toThrow(/Two targets are named "Icons"/);
  });

  it("should reject a match that is not a string, RegExp or function", async () => {
    await expect(
      plugin({
        type: "manual",
        targets: [{ fontName: "Icons", match: 42 as unknown as string, ligatures: ["close"] }],
      }),
    ).rejects.toThrow(/must be a string, a RegExp or a function/);
  });
});
