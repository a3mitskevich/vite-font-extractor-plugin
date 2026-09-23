import { isCSSRequest } from "vite";
import type { FontFaceMeta, OptionsWithCacheSid, SubsetOptions } from "./types";
import {
  exists,
  extractFontFaces,
  extractFontName,
  extractFonts,
  extractGoogleFontsUrls,
  findUnicodeGlyphs,
  getHash,
  stripBase,
  stripCssComments,
  toError,
  createSubsetOptions,
} from "./utils";
import styler from "./styler";
import { FONT_FACE_BLOCK_REGEX, GOOGLE_FONT_URL_RE } from "./constants";
import { getGoogleFontFamilies, getGoogleFontText, setGoogleFontText } from "./google-fonts";
import { type PluginContext, getLogger } from "./context";
import { checkFontProcessing } from "./minify";
import { createServeFontLoader, type ServeFontRequest } from "./serve";
import {
  type AssetReference,
  extractAssetReferences,
  getFaceGroupId,
  getReferenceKey,
  getStandaloneGroupId,
} from "./asset-refs";

interface RegisterOptions {
  fontName: string;
  groupId: string;
  getOptions: (subset?: SubsetOptions) => OptionsWithCacheSid;
  // Target fonts take precedence over fonts registered only by their `?subset=` query
  overwrite: boolean;
}

function registerReferences(
  ctx: PluginContext,
  references: AssetReference[],
  { fontName, groupId, getOptions, overwrite }: RegisterOptions,
): void {
  for (const reference of references) {
    // Families sharing one file may have different options — each needs its own entry
    const key = `${getReferenceKey(reference)}:${fontName}`;
    if (!overwrite && ctx.transformMap.has(key)) continue;
    ctx.transformMap.set(key, {
      fontName,
      options: getOptions(reference.subset),
      subset: reference.subset,
      referenceId: reference.referenceId,
      groupId,
    });
  }
}

const FAMILY_QUERY_PARAM = "font-extractor-family";
const FACE_URL_RE = /url\((['"]?)(.*?)\1\)/g;

// Dev: a file shared by several families is requested once per family
const tagFamilyUrl = (url: string, fontName: string): string =>
  `${url}${url.includes("?") ? "&" : "?"}${FAMILY_QUERY_PARAM}=${getHash(fontName)}`;

function registerServeProxy(
  ctx: PluginContext,
  requestUrl: string,
  request: ServeFontRequest,
): void {
  if (ctx.fontServeProxy.has(requestUrl)) {
    return;
  }
  ctx.fontServeProxy.set(requestUrl, createServeFontLoader(ctx, request));
  if (request.auto) {
    ctx.loadedAutoFontMap.set(requestUrl, false);
  }
}

function serveFont(ctx: PluginContext, code: string, id: string, font: FontFaceMeta): string {
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

async function processFont(
  ctx: PluginContext,
  code: string,
  id: string,
  font: FontFaceMeta,
): Promise<string> {
  checkFontProcessing(ctx, font.name, id);
  if (ctx.isServe) {
    return serveFont(ctx, code, id, font);
  } else {
    if (ctx.mode === "auto") {
      getLogger(ctx).warn(
        `"auto" mode detected. "${font.name}" font is stubbed based on auto-detected glyphs.` +
          " If this font is not a target please add it to ignore.",
      );
    }
    const references = extractAssetReferences(font.aliases.join("\n"));
    registerReferences(ctx, references, {
      fontName: font.name,
      groupId: getFaceGroupId(references),
      getOptions: () => font.options,
      overwrite: true,
    });
  }
  return code;
}

// Font face without target options — minified only when its sources use `?subset=`
function registerSubsetFace(ctx: PluginContext, name: string, aliases: string[]): void {
  if (!aliases.some((alias) => alias.includes("?subset="))) {
    getLogger(ctx).warn(`Font "${name}" has no minify options — add to targets or use ?subset=`);
    return;
  }
  const references = extractAssetReferences(aliases.join("\n")).filter((ref) => ref.subset);
  registerReferences(ctx, references, {
    fontName: name,
    groupId: getFaceGroupId(references),
    getOptions: (subset) => createSubsetOptions(name, subset ?? {}),
    overwrite: false,
  });
}

// `?subset=` anywhere else, e.g. `import font from './font.woff2?subset=ABC'` in JS.
// @font-face sources belong to their family (targets, `ignore`) and are skipped here
function registerStandaloneSubsets(ctx: PluginContext, code: string): void {
  for (const reference of extractAssetReferences(code.replace(FONT_FACE_BLOCK_REGEX, ""))) {
    if (!reference.subset) continue;
    const fontName = `subset (${reference.referenceId.substring(0, 6)})`;
    registerReferences(ctx, [reference], {
      fontName,
      groupId: getStandaloneGroupId(reference.referenceId),
      getOptions: (subset) => createSubsetOptions(fontName, subset ?? {}),
      overwrite: false,
    });
  }
}

function getGoogleFontTexts(ctx: PluginContext, name: string, id: string): string[] {
  if (ctx.pluginOption.ignore?.includes(name)) {
    return [];
  }
  const options = ctx.optionsMap.get(name);
  if (!options) {
    getLogger(ctx).warn(`Font "${name}" has no minify options`);
    return [];
  }
  checkFontProcessing(ctx, name, id);
  return options.target.ligatures ?? [];
}

// Adds `text=` with the target glyphs to a Google Fonts stylesheet url
function processGoogleFontUrl(ctx: PluginContext, raw: string, id: string): string {
  const logger = getLogger(ctx);
  try {
    const families = getGoogleFontFamilies(raw);
    if (!families.length) {
      logger.warn(`No specified google font name in ${styler.path(id)}`);
      return raw;
    }
    const texts = [...new Set(families.flatMap((name) => getGoogleFontTexts(ctx, name, id)))];
    if (!texts.length) {
      return raw;
    }
    const oldText = getGoogleFontText(raw);
    if (oldText) {
      logger.warn(`Font [${families.join("|")}] in ${id} has duplicated logic for minification`);
    }
    return setGoogleFontText(raw, [oldText, ...texts].filter(exists).join(" "));
  } catch (e) {
    logger.error(`Process Google font URL is failed`, { error: toError(e) });
    return raw;
  }
}

function rewriteGoogleFontUrls(
  ctx: PluginContext,
  code: string,
  cleanedCode: string,
  id: string,
): string {
  // Urls inside comments are left as is
  const urls = new Set(extractGoogleFontsUrls(cleanedCode));
  return code.replace(GOOGLE_FONT_URL_RE, (raw) =>
    urls.has(raw) ? processGoogleFontUrl(ctx, raw, id) : raw,
  );
}

export async function transformHook(ctx: PluginContext, code: string, id: string): Promise<string> {
  const logger = getLogger(ctx);

  const isCssFile = isCSSRequest(id);
  const isAutoType = ctx.mode === "auto";
  // Strip CSS comments once for all regex-based parsing
  const cleanedCode = isCssFile || id.endsWith(".html") ? stripCssComments(code) : code;
  const isCssFileWithFontFaces = isCssFile && cleanedCode.includes("@font-face");

  if (isAutoType && isCssFile) {
    const glyphs = findUnicodeGlyphs(cleanedCode);
    ctx.glyphsFindMap.set(id, glyphs);
  }
  if (
    (id.endsWith(".html") || (isCssFile && cleanedCode.includes("@import"))) &&
    cleanedCode.includes("fonts.googleapis.com")
  ) {
    code = rewriteGoogleFontUrls(ctx, code, cleanedCode, id);
  }
  if (isCssFileWithFontFaces) {
    const fonts = extractFontFaces(cleanedCode)
      .map<FontFaceMeta | null>((face) => {
        const name = extractFontName(face);
        if (ctx.pluginOption.ignore?.includes(name)) {
          return null;
        }
        const options = ctx.optionsMap.get(name);

        const aliases = extractFonts(face);

        if (!options) {
          // Dev minifies a face without a target by its `?subset=` alone, like build
          if (ctx.isServe && aliases.some((alias) => alias.includes("?subset="))) {
            return { name, face, aliases, options: createSubsetOptions(name, {}) };
          }
          registerSubsetFace(ctx, name, aliases);
          return null;
        }

        const urlSources = aliases.filter((alias) => alias.startsWith("http"));
        if (urlSources.length) {
          logger.warn(`Font "${name}" has external url sources: ${urlSources.toString()}`);
          return null;
        }

        return { name, face, aliases, options };
      })
      .filter(exists);
    for (const font of fonts) {
      try {
        code = await processFont(ctx, code, id, font);
      } catch (e) {
        logger.error(`Process ${font.name} local font is failed`, { error: toError(e) });
      }
    }
  }

  if (!ctx.isServe && code.includes("?subset=")) {
    registerStandaloneSubsets(ctx, code);
  }

  return code;
}
