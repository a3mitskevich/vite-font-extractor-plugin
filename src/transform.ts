import { isCSSRequest } from "vite";
import type { TransformPluginContext } from "rollup";
import type { FontFaceMeta } from "./types";
import {
  exists,
  extractFontFaces,
  extractFontName,
  extractFonts,
  extractGoogleFontsUrls,
  findUnicodeGlyphs,
} from "./utils";
import styler from "./styler";
import { type PluginContext, getLogger } from "./context";
import { checkFontProcessing } from "./minify";
import { processServeAutoFontMinify, processServeFontMinify } from "./serve";

const VITE_ASSET_RE = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g;

function collectFontReferences(
  ctx: PluginContext,
  code: string,
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
        ctx.transformMap.set(referenceId, { fontName, options });
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
  logger.fix();

  const isCssFile = isCSSRequest(id);
  const isAutoType = ctx.mode === "auto";
  const isCssFileWithFontFaces = isCssFile && code.includes("@font-face");

  if (isAutoType && isCssFile) {
    const glyphs = findUnicodeGlyphs(code);
    ctx.glyphsFindMap.set(id, glyphs);
  }
  if (
    (id.endsWith(".html") || (isCssFile && code.includes("@import"))) &&
    code.includes("fonts.googleapis.com")
  ) {
    for (const raw of extractGoogleFontsUrls(code)) {
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
        logger.error(`Process Google font URL is failed`, { error: e as Error });
      }
    }
  }
  if (isCssFileWithFontFaces) {
    const fonts = extractFontFaces(code)
      .map<FontFaceMeta | null>((face) => {
        const name = extractFontName(face);
        if (ctx.pluginOption.ignore?.includes(name)) {
          return null;
        }
        const options = ctx.optionsMap.get(name);

        if (!options) {
          logger.warn(`Font "${name}" has no minify options`);
          return null;
        }

        const aliases = extractFonts(face);

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
        logger.error(`Process ${font.name} local font is failed`, { error: e as Error });
      }
    }
  }
  return code;
}
