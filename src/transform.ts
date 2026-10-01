import type { FontFaceMeta } from "./types";
import {
  extractFontFaces,
  extractFontName,
  extractFonts,
  findUnicodeGlyphs,
  getHash,
  stripBase,
  stripCssComments,
  toError,
} from "./utils";
import { type PluginContext, getLogger } from "./context";
import { checkFontProcessing } from "./minify";
import { reloadAutoFonts, type ServeFontRequest } from "./serve";
import { beginServeTransform, registerServeUrl } from "./serve-registry";
import { hasGoogleFontUrl, rewriteGoogleFontUrls } from "./google-rewrite";
import { resolveFaceOptions } from "./face-options";

const FAMILY_QUERY_PARAM = "font-extractor-family";
const GLYPHS_QUERY_PARAM = "font-extractor-glyphs";
const FACE_URL_RE = /url\((['"]?)(.*?)\1\)/g;

// Auto mode: glyphs of CSS `content` in the module (build: compiled CSS, dev: served CSS).
// Returns whether the glyphs of the build changed
export function collectContentGlyphs(ctx: PluginContext, code: string, id: string): boolean {
  if (ctx.mode !== "auto") return false;
  const before = ctx.autoProxyOption.sid;
  const glyphs = findUnicodeGlyphs(stripCssComments(code));
  ctx.glyphsFindMap.set(id, glyphs);
  if (glyphs.length) getLogger(ctx).debug(() => `auto: ${glyphs.length} glyphs in CSS content`, id);
  return ctx.autoProxyOption.sid !== before;
}

// CSS `@import` of a Google Fonts stylesheet
export const rewriteCssGoogleFonts = (ctx: PluginContext, code: string, id: string): string =>
  code.includes("@import") && hasGoogleFontUrl(stripCssComments(code))
    ? rewriteGoogleFontUrls(ctx, code, { file: id, moduleId: id })
    : code;

// Dev: a file shared by several families is requested once per family; an auto font once per
// glyph set, so the browser loads it again when the glyphs change
function tagFamilyUrl(ctx: PluginContext, url: string, font: FontFaceMeta): string {
  const separator = url.includes("?") ? "&" : "?";
  const tagged = `${url}${separator}${FAMILY_QUERY_PARAM}=${getHash(font.name)}`;
  return font.options.auto
    ? `${tagged}&${GLYPHS_QUERY_PARAM}=${getHash(ctx.autoProxyOption.sid)}`
    : tagged;
}

function serveFont(ctx: PluginContext, code: string, id: string, font: FontFaceMeta): string {
  checkFontProcessing(ctx, font.name, id);
  if (font.options.auto) ctx.autoFaceModules.add(id);
  const localUrls = font.aliases.filter((url) => !url.startsWith("data:"));
  const sourceUrls = localUrls.map((url) => stripBase(url, ctx.base));
  localUrls.forEach((url, index) => {
    const request: ServeFontRequest = {
      importer: id,
      url: sourceUrls[index],
      aliases: sourceUrls,
      fontName: font.name,
      options: font.options,
    };
    // The plain url keeps working (served for the first family of the module's last transform)
    registerServeUrl(ctx, id, url, request);
    registerServeUrl(ctx, id, tagFamilyUrl(ctx, url, font), request);
    getLogger(ctx).debug(
      () => `dev: "${font.name}" ${url} registered as ${tagFamilyUrl(ctx, url, font)}`,
      id,
    );
  });
  // Face text differs from the source when it contains comments — keep plain urls then
  if (!code.includes(font.face)) {
    return code;
  }
  const taggedFace = font.face.replace(FACE_URL_RE, (match, quote: string, url: string) =>
    localUrls.includes(url) ? `url(${quote}${tagFamilyUrl(ctx, url, font)}${quote})` : match,
  );
  // A function: `$&` or `$1` in a url is text, not a replacement pattern
  return code.replace(font.face, () => taggedFace);
}

// A face the dev server minifies: a target, or `?subset=` without one — decided like in build
// (face-options.ts traces the decision)
function toServedFace(ctx: PluginContext, face: string, id: string): FontFaceMeta | null {
  const name = extractFontName(face);
  const aliases = extractFonts(face);
  getLogger(ctx).debug(() => `dev: @font-face "${name}" ${aliases.join(", ")}`, id);
  const resolved = resolveFaceOptions(ctx, { family: name, urls: aliases, id, report: "remote" });
  return resolved ? { name, face, aliases, options: resolved.options } : null;
}

/**
 * Dev: CSS is served as it is, fonts are minified lazily when the browser requests them. Every
 * @font-face url of a font to minify is registered with the dev middleware, tagged per family.
 */
export function transformServedCss(ctx: PluginContext, code: string, id: string): string {
  beginServeTransform(ctx, id);
  if (collectContentGlyphs(ctx, code, id)) reloadAutoFonts(ctx, id);
  let result = rewriteCssGoogleFonts(ctx, code, id);
  const cleaned = stripCssComments(result);
  if (!cleaned.includes("@font-face")) return result;
  for (const face of extractFontFaces(cleaned)) {
    try {
      // `match` and `resolveTarget` are user code: a throw must not break the stylesheet
      const served = toServedFace(ctx, face, id);
      if (served) result = serveFont(ctx, result, id, served);
    } catch (e) {
      const error = toError(e);
      const message = `Process ${extractFontName(face)} local font is failed: ${error.message}`;
      getLogger(ctx).error(message, { error });
    }
  }
  return result;
}
