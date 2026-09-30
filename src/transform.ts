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
import { createServeFontLoader, type ServeFontRequest } from "./serve";
import { hasSubsetParam } from "./subset-options";
import { hasGoogleFontUrl, rewriteGoogleFontUrls } from "./google-rewrite";
import { isRemoteUrl } from "./face-options";

const FAMILY_QUERY_PARAM = "font-extractor-family";
const FACE_URL_RE = /url\((['"]?)(.*?)\1\)/g;

// Auto mode: glyphs of CSS `content` in the module (build: compiled CSS, dev: served CSS)
export function collectContentGlyphs(ctx: PluginContext, code: string, id: string): void {
  if (ctx.mode === "auto") {
    ctx.glyphsFindMap.set(id, findUnicodeGlyphs(stripCssComments(code)));
  }
}

// CSS `@import` of a Google Fonts stylesheet
export const rewriteCssGoogleFonts = (ctx: PluginContext, code: string, id: string): string =>
  code.includes("@import") && hasGoogleFontUrl(stripCssComments(code))
    ? rewriteGoogleFontUrls(ctx, code, id)
    : code;

// Dev: a file shared by several families is requested once per family
const tagFamilyUrl = (url: string, fontName: string): string =>
  `${url}${url.includes("?") ? "&" : "?"}${FAMILY_QUERY_PARAM}=${getHash(fontName)}`;

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
    registerServeProxy(ctx, tagFamilyUrl(url, font.name), request);
  });
  // Face text differs from the source when it contains comments — keep plain urls then
  if (!code.includes(font.face)) {
    return code;
  }
  const taggedFace = font.face.replace(FACE_URL_RE, (match, quote: string, url: string) =>
    localUrls.includes(url) ? `url(${quote}${tagFamilyUrl(url, font.name)}${quote})` : match,
  );
  return code.replace(font.face, taggedFace);
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
  collectContentGlyphs(ctx, code, id);
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
