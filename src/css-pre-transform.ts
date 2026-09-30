import { existsSync } from "node:fs";
import { join } from "node:path";
import { MagicString } from "magic-string";
import type { Rollup } from "vite";
import { type PluginContext, getCssResolvers, getLogger } from "./context";
import { type CssUrl, findFontFaces } from "./css-faces";
import { resolveFaceOptions, isRemoteUrl } from "./face-options";
import { emitFont, type FontSource, minifyFace, splitUrl, toCssUrl } from "./font-emit";
import { cleanUrl } from "./utils";

const PREPROCESSOR_RE = /\.(?:less|sass|scss|styl|stylus)(?:$|\?)/;
const SKIPPED_URL_RE = /^(?:data:|#|__VITE_ASSET__)/;

export interface TransformOutput {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
}

const safeDecode = (url: string): string => {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};

// Files in `public/` are copied as they are, Vite does not emit them
const isPublicUrl = (ctx: PluginContext, path: string): boolean =>
  !!ctx.publicDir && path.startsWith("/") && existsSync(join(ctx.publicDir, path));

async function resolveSource(
  ctx: PluginContext,
  url: CssUrl,
  importer: string,
): Promise<FontSource | null> {
  const logger = getLogger(ctx);
  if (SKIPPED_URL_RE.test(url.url) || isRemoteUrl(url.url)) {
    logger.debug(() => `L1: ${url.url.slice(0, 40)} is not a local file — skipped`, importer);
    return null;
  }
  const { path, query } = splitUrl(safeDecode(url.url));
  if (isPublicUrl(ctx, path)) {
    logger.debug(`L1: ${path} is in public/ — Vite copies it as is`, importer);
    return null;
  }
  const file = await getCssResolvers(ctx)
    .url(path, importer)
    .catch(() => undefined);
  logger.debug(() => `L1: ${url.url} → ${file ? cleanUrl(file) : "not resolved"}`, importer);
  return file ? { file: cleanUrl(file), query } : null;
}

/**
 * Before vite:css: an @font-face written in the module source gets its minified font emitted by
 * the plugin and `url(__VITE_ASSET__<ref>__)` in place of the file. vite:css keeps such urls and
 * Vite resolves them to the emitted file name when it renders the CSS, so the CSS is hashed with
 * the minified font's name and Vite never emits the original for it.
 *
 * Faces computed by a preprocessor (variables, mixins) or coming from imported files are left to
 * the pass after vite:css (css-swap.ts). Auto mode waits for all CSS there as well.
 */
export async function transformFaceSources(
  pluginContext: Pick<Rollup.PluginContext, "emitFile" | "getFileName">,
  ctx: PluginContext,
  code: string,
  id: string,
): Promise<TransformOutput | null> {
  if (!code.includes("@font-face")) return null;
  const importer = cleanUrl(id);
  const logger = getLogger(ctx);
  const faces = findFontFaces(code, PREPROCESSOR_RE.test(id));
  const output = new MagicString(code);
  for (const face of faces) {
    const urls = face.urls.map((url) => url.url);
    logger.debug(() => `L1: @font-face "${face.family}" ${urls.join(", ")}`, id);
    if (face.isDynamic) {
      logger.debug(`L1: "${face.family}" is computed by the preprocessor — left to L2`, id);
      continue;
    }
    const options = resolveFaceOptions(ctx, { family: face.family, urls, report: false });
    if (!options) continue;
    if (options.auto) {
      logger.debug(`L1: "${face.family}" is auto — left to L2 (waits for the glyphs)`, id);
      continue;
    }
    const resolved = await Promise.all(face.urls.map((url) => resolveSource(ctx, url, importer)));
    const sources = resolved.filter((source): source is FontSource => !!source);
    if (!sources.length) {
      logger.debug(`L1: "${face.family}" has no local source — left to L2`, id);
      continue;
    }
    const minified = await minifyFace(ctx, { fontName: face.family, options, sources });
    for (const [index, url] of face.urls.entries()) {
      const source = resolved[index];
      const content = source && minified.get(source.file + source.query);
      if (!source || !content) {
        if (source) logger.debug(`L1: ${url.url} has no smaller result — keeps original`, id);
        continue;
      }
      output.overwrite(
        url.start,
        url.end,
        toCssUrl(await emitFont(pluginContext, ctx, source, content)),
      );
    }
  }
  return output.hasChanged()
    ? { code: output.toString(), map: output.generateMap({ hires: "boundary", source: id }) }
    : null;
}
