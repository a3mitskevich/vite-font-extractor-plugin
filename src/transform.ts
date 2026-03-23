import { isCSSRequest } from "vite";
import type { TransformPluginContext } from "rollup";
import type { FontFaceMeta, SubsetOptions } from "./types";
import {
  exists,
  extractFontFaces,
  extractFontName,
  extractFonts,
  extractGoogleFontsUrls,
  findUnicodeGlyphs,
  stripCssComments,
  toError,
  createSubsetOptions,
} from "./utils";
import styler from "./styler";
import { type PluginContext, getLogger } from "./context";
import { checkFontProcessing } from "./minify";
import { processServeAutoFontMinify, processServeFontMinify } from "./serve";

const VITE_ASSET_RE = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g;
const SUBSET_RE = /[?&]subset=([^&'")\s]+)/;

function parseSubsetParam(url: string): SubsetOptions | undefined {
  const match = SUBSET_RE.exec(url);
  if (!match) return undefined;

  // Strip trailing __ from Vite asset placeholder query
  const rawValue = match[1].replace(/__+$/, "");
  const parts = rawValue.split(",");
  const characters: string[] = [];
  const unicodeRanges: string[] = [];

  for (const part of parts) {
    if (part.startsWith("U+") || part.startsWith("u+")) {
      unicodeRanges.push(part);
    } else {
      characters.push(part);
    }
  }

  return {
    characters: characters.length > 0 ? characters.join("") : undefined,
    unicodeRanges: unicodeRanges.length > 0 ? unicodeRanges : undefined,
  };
}

function collectFontReferences(
  ctx: PluginContext,
  _code: string,
  fontName: string,
  aliases: string[],
): void {
  for (const alias of aliases) {
    VITE_ASSET_RE.lastIndex = 0;
    const match = VITE_ASSET_RE.exec(alias);
    if (match) {
      const referenceId = match[1];
      const options = ctx.optionsMap.get(fontName);
      if (options) {
        const subset = parseSubsetParam(alias);
        // Composite key: same file with different ?subset= → different entries
        const subsetKey = subset ? JSON.stringify(subset) : "";
        const mapKey = `${referenceId}:${subsetKey}`;
        ctx.transformMap.set(mapKey, { fontName, options, subset, referenceId });
      }
    }
  }
}

async function processFont(
  _rollupCtx: TransformPluginContext,
  ctx: PluginContext,
  code: string,
  id: string,
  font: FontFaceMeta,
): Promise<string> {
  checkFontProcessing(ctx, font.name, id);
  if (ctx.isServe) {
    font.aliases.forEach((url) => {
      if (ctx.fontServeProxy.has(url)) {
        return;
      }
      const process = font.options.auto
        ? processServeAutoFontMinify(ctx, id, url, font.name)
        : processServeFontMinify(ctx, id, url, font.name);
      ctx.fontServeProxy.set(url, process);
      if (font.options.auto) {
        ctx.loadedAutoFontMap.set(url, false);
      }
    });
  } else {
    if (ctx.mode === "auto") {
      getLogger(ctx).warn(
        `"auto" mode detected. "${font.name}" font is stubbed based on auto-detected glyphs.` +
          " If this font is not a target please add it to ignore.",
      );
    }
    collectFontReferences(ctx, code, font.name, font.aliases);
  }
  return code;
}

export async function transformHook(
  rollupCtx: TransformPluginContext,
  ctx: PluginContext,
  code: string,
  id: string,
): Promise<string> {
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
    for (const raw of extractGoogleFontsUrls(cleanedCode)) {
      try {
        const url = new URL(raw);
        const familyParam = url.searchParams.get("family");
        if (!familyParam) {
          logger.warn(`No specified google font name in ${styler.path(id)}`);
          continue;
        }

        // Support multiple families separated by "|"
        const families = familyParam.split("|").map((f) => f.replace(/\+/g, " ").trim());
        const allTexts: string[] = [];

        for (const name of families) {
          if (ctx.pluginOption.ignore?.includes(name)) {
            continue;
          }

          const options = ctx.optionsMap.get(name);
          if (!options) {
            logger.warn(`Font "${name}" has no minify options`);
            continue;
          }

          checkFontProcessing(ctx, name, id);
          allTexts.push(...(options.target.ligatures ?? []));
        }

        if (allTexts.length > 0) {
          const oldText = url.searchParams.get("text");
          if (oldText) {
            logger.warn(`Font [${familyParam}] in ${id} has duplicated logic for minification`);
          }
          const text = [oldText, ...allTexts].filter(exists).join(" ");
          const originalUrl = url.toString();
          const fixedUrl = new URL(originalUrl);
          fixedUrl.searchParams.set("text", text);
          code = code.replace(originalUrl, fixedUrl.toString());
        }
      } catch (e) {
        logger.error(`Process Google font URL is failed`, { error: toError(e) });
      }
    }
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
          // Don't warn if font uses ?subset= — it will be processed via subset pipeline
          const hasSubset = aliases.some((alias) => alias.includes("?subset="));
          if (!hasSubset) {
            logger.warn(`Font "${name}" has no minify options — add to targets or use ?subset=`);
          }
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
        code = await processFont(rollupCtx, ctx, code, id, font);
      } catch (e) {
        logger.error(`Process ${font.name} local font is failed`, { error: toError(e) });
      }
    }
  }

  // Handle ?subset= in any file (JS imports, CSS, HTML)
  // Vite transforms `import font from './font.woff2?subset=ABC'` into
  // `export default "__VITE_ASSET__<refId>__$_?subset=ABC__"`
  if (code.includes("?subset=")) {
    const globalAssetRe = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g;
    let assetMatch;
    while ((assetMatch = globalAssetRe.exec(code))) {
      const query = assetMatch[2];
      if (!query || !query.includes("subset=")) continue;

      const referenceId = assetMatch[1];
      const subset = parseSubsetParam(query);
      if (!subset) continue;

      const subsetKey = JSON.stringify(subset);
      const mapKey = `${referenceId}:${subsetKey}`;
      if (ctx.transformMap.has(mapKey)) continue;

      {
        const fontName = `__subset_${referenceId}_${subsetKey.length}`;
        const options = createSubsetOptions(fontName, subset);
        ctx.transformMap.set(mapKey, { fontName, options, subset, referenceId });
      }
    }
  }

  return code;
}
