import { resolve } from "node:path";
import type { Rollup } from "vite";
import type { PluginContext } from "./context";

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const PRELOAD_REL_RE = /\brel\s*=\s*["']?[^"'>]*\bpreload\b/i;
const ASSET_PLACEHOLDER_RE = /__VITE_ASSET__([\w$]+)__/g;

type GetFileName = (referenceId: string) => string;

// Reference id of the one minified font emitted for `files` without `?subset=`, if there is one
function findPlainResult(ctx: PluginContext, files: Set<string>): string | undefined {
  const matches = [...ctx.emittedFonts].filter(([, font]) => font.isPlain && files.has(font.file));
  const names = new Set(matches.map(([, font]) => font.fileName));
  // Families minified differently from one file: a preload can not tell which one to follow
  return names.size === 1 ? matches[0][0] : undefined;
}

/**
 * Build, `transformIndexHtml` (post): a `<link rel="preload">` of a font the CSS now loads minified
 * is pointed at the minified file. Vite has not resolved the asset placeholders of the HTML yet,
 * so only the reference changes: Vite writes the file name and lists it in the manifest.
 */
export function redirectFontPreloads(
  ctx: PluginContext,
  html: string,
  getFileName: GetFileName,
  bundle: Rollup.OutputBundle,
): string {
  if (!ctx.emittedFonts.size) return html;
  return html.replace(LINK_TAG_RE, (tag) => {
    if (!PRELOAD_REL_RE.test(tag)) return tag;
    return tag.replace(ASSET_PLACEHOLDER_RE, (placeholder, referenceId: string) => {
      if (ctx.emittedFonts.has(referenceId)) return placeholder;
      const asset = bundle[getFileName(referenceId)];
      if (asset?.type !== "asset") return placeholder;
      const files = new Set(asset.originalFileNames.map((file) => resolve(ctx.root, file)));
      const minified = findPlainResult(ctx, files);
      return minified ? `__VITE_ASSET__${minified}__` : placeholder;
    });
  });
}
