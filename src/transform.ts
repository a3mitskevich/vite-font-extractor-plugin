import type { FontFaceMeta } from "./types";
import {
  exists,
  extractFontFaces,
  extractFontName,
  extractFonts,
  findUnicodeGlyphs,
  getHash,
  stripBase,
  stripCssComments,
  toError,
  createSubsetOptions,
} from "./utils";
import { type PluginContext, getLogger } from "./context";
import { checkFontProcessing } from "./minify";
import { createServeFontLoader, reloadAutoFonts, type ServeFontRequest } from "./serve";
import { hasSubsetParam } from "./subset-options";
import { hasGoogleFontUrl, rewriteGoogleFontUrls } from "./google-rewrite";
import { isRemoteUrl } from "./face-options";

const FAMILY_QUERY_PARAM = "font-extractor-family";
const GLYPHS_QUERY_PARAM = "font-extractor-glyphs";
const FACE_URL_RE = /url\((['"]?)(.*?)\1\)/g;

// Auto mode: glyphs of CSS `content` in the module (build: compiled CSS, dev: served CSS).
// Returns whether the glyphs of the build changed
export function collectContentGlyphs(ctx: PluginContext, code: string, id: string): boolean {
  if (ctx.mode !== "auto") return false;
  const before = ctx.autoProxyOption.sid;
  ctx.glyphsFindMap.set(id, findUnicodeGlyphs(stripCssComments(code)));
  return ctx.autoProxyOption.sid !== before;
}

// CSS `@import` of a Google Fonts stylesheet
export const rewriteCssGoogleFonts = (ctx: PluginContext, code: string, id: string): string =>
  code.includes("@import") && hasGoogleFontUrl(stripCssComments(code))
    ? rewriteGoogleFontUrls(ctx, code, id)
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

function registerServeProxy(
  ctx: PluginContext,
  requestUrl: string,
  request: ServeFontRequest,
): void {
  if (!ctx.fontServeProxy.has(requestUrl)) {
    ctx.fontServeProxy.set(requestUrl, createServeFontLoader(ctx, request));
  }
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
      auto: font.options.auto,
    };
    // The plain url keeps working (served for the first family that registered it)
    registerServeProxy(ctx, url, request);
    registerServeProxy(ctx, tagFamilyUrl(ctx, url, font), request);
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

// A face the dev server minifies: a target, or `?subset=` without one
function toServedFace(ctx: PluginContext, face: string): FontFaceMeta | null {
  const name = extractFontName(face);
  if (ctx.pluginOption.ignore?.includes(name)) return null;
  const aliases = extractFonts(face);
  const options = ctx.optionsMap.get(name);
  if (!options) {
    return aliases.some(hasSubsetParam)
      ? { name, face, aliases, options: createSubsetOptions(name, {}) }
      : null;
  }
  const remote = aliases.filter(isRemoteUrl);
  if (remote.length) {
    getLogger(ctx).warn(`Font "${name}" has external url sources: ${remote.toString()}`);
    return null;
  }
  return { name, face, aliases, options };
}

/**
 * Dev: CSS is served as it is, fonts are minified lazily when the browser requests them. Every
 * @font-face url of a font to minify is registered with the dev middleware, tagged per family.
 */
export function transformServedCss(ctx: PluginContext, code: string, id: string): string {
  if (collectContentGlyphs(ctx, code, id)) reloadAutoFonts(ctx, id);
  let result = rewriteCssGoogleFonts(ctx, code, id);
  const cleaned = stripCssComments(result);
  if (!cleaned.includes("@font-face")) return result;
  const faces = extractFontFaces(cleaned)
    .map((face) => toServedFace(ctx, face))
    .filter(exists);
  for (const face of faces) {
    try {
      result = serveFont(ctx, result, id, face);
    } catch (e) {
      getLogger(ctx).error(`Process ${face.name} local font is failed`, { error: toError(e) });
    }
  }
  return result;
}
