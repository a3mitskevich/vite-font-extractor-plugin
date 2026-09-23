import type { Rollup } from "vite";
import type { PluginContext } from "./context";
import { FONT_FACE_BLOCK_RE, getBlockFamily } from "./output-font-face";

const DATA_URL_SOURCE_RE = /url\(\s*["']?data:/;

const textOf = (item: Rollup.OutputAsset | Rollup.OutputChunk): string | null => {
  if (item.type === "chunk") return item.code;
  return typeof item.source === "string" ? item.source : null;
};

const isMinifyCandidate = (ctx: PluginContext, family: string): boolean =>
  ctx.optionsMap.has(family) && !ctx.pluginOption.ignore?.includes(family);

// Families whose @font-face sources were inlined as data: URLs (build.lib, build.assetsInlineLimit):
// Vite never emits such files, so there is nothing to minify
function findInlinedFamilies(ctx: PluginContext, bundle: Rollup.OutputBundle): Set<string> {
  const families = new Set<string>();
  for (const item of Object.values(bundle)) {
    const text = textOf(item);
    if (!text?.includes("@font-face")) continue;
    for (const [block] of text.matchAll(FONT_FACE_BLOCK_RE)) {
      const family = getBlockFamily(block);
      if (family && DATA_URL_SOURCE_RE.test(block) && isMinifyCandidate(ctx, family)) {
        families.add(family);
      }
    }
  }
  return families;
}

export function warnInlinedFonts(
  ctx: PluginContext,
  bundle: Rollup.OutputBundle,
  warn: (message: string) => void,
): void {
  for (const family of findInlinedFamilies(ctx, bundle)) {
    warn(
      `Font "${family}" is inlined as a data: URL (build.lib or build.assetsInlineLimit) and is not minified. ` +
        "Exclude font files from inlining to minify them",
    );
  }
}
