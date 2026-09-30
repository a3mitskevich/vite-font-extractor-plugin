import { dirname, join, resolve } from "node:path";
import { normalizePath, type Rollup } from "vite";
import type { PluginContext } from "./context";

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const PRELOAD_REL_RE = /\brel\s*=\s*["']?[^"'>]*\bpreload\b/i;
const ASSET_PLACEHOLDER_RE = /__VITE_ASSET__([\w$]+)__/g;
const HREF_RE = /\bhref\s*=\s*(["']?)([^"'\s>]+)\1/i;
const LOCAL_HREF_RE = /^(?![a-z][a-z\d+.-]*:|\/\/|#)/i;

type GetFileName = (referenceId: string) => string;

/**
 * `transformIndexHtml` (pre): source files the preloads of an HTML file load. Vite resolves them
 * to assets that may merge several files with identical bytes, so the post hook needs to know
 * which of them the HTML meant.
 */
export function recordPreloadSources(ctx: PluginContext, html: string, filename: string): void {
  const files = new Set<string>();
  for (const [tag] of html.matchAll(LINK_TAG_RE)) {
    const href = HREF_RE.exec(tag)?.[2];
    if (!PRELOAD_REL_RE.test(tag) || !href || !LOCAL_HREF_RE.test(href)) continue;
    const path = href.replace(/[?#].*$/s, "");
    files.add(
      normalizePath(path.startsWith("/") ? join(ctx.root, path) : resolve(dirname(filename), path)),
    );
  }
  ctx.preloadSources.set(filename, files);
}

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
  filename: string,
  getFileName: GetFileName,
  bundle: Rollup.OutputBundle,
): string {
  if (!ctx.emittedFonts.size) return html;
  const preloaded = ctx.preloadSources.get(filename);
  return html.replace(LINK_TAG_RE, (tag) => {
    if (!PRELOAD_REL_RE.test(tag)) return tag;
    return tag.replace(ASSET_PLACEHOLDER_RE, (placeholder, referenceId: string) => {
      if (ctx.emittedFonts.has(referenceId)) return placeholder;
      const asset = bundle[getFileName(referenceId)];
      if (asset?.type !== "asset") return placeholder;
      const files = new Set(
        asset.originalFileNames
          .map((file) => normalizePath(resolve(ctx.root, file)))
          .filter((file) => !preloaded || preloaded.has(file)),
      );
      const minified = findPlainResult(ctx, files);
      return minified ? `__VITE_ASSET__${minified}__` : placeholder;
    });
  });
}
