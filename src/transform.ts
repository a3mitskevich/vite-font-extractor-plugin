import { isCSSRequest } from "vite";
import type { TransformPluginContext } from "rollup";
import type { FontFaceMeta, GoogleFontMeta, ResourceTransformMeta } from "./types";
import {
  exists,
  extractFontFaces,
  extractFontName,
  extractFonts,
  extractGoogleFontsUrls,
  findUnicodeGlyphs,
  getHash,
} from "./utils";
import { PROCESS_EXTENSION } from "./constants";
import styler from "./styler";
import type { PluginContext } from "./context";
import { checkFontProcessing } from "./minify";
import { processServeAutoFontMinify, processServeFontMinify } from "./serve";

function changeResource(
  rollupCtx: TransformPluginContext,
  ctx: PluginContext,
  code: string,
  transform: ResourceTransformMeta,
): string {
  const sid = getHash(transform.sid);
  const assetUrlRE = /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g;
  const oldReferenceId = assetUrlRE.exec(transform.alias)![1];
  const referenceId = rollupCtx.emitFile({
    type: "asset",
    name: transform.name + PROCESS_EXTENSION,
    source: Buffer.from(sid + oldReferenceId),
  });
  ctx.transformMap.set(oldReferenceId, referenceId);
  // TODO: rework to generate new url strings by config instead replace a old reference id
  return code.replace(transform.alias, transform.alias.replace(oldReferenceId, referenceId));
}

async function processFont(
  rollupCtx: TransformPluginContext,
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
      ctx.logger.warn(
        `"auto" mode detected. "${font.name}" font is stubbed based on auto-detected glyphs.` +
          " If this font is not a target please add it to ignore.",
      );
    }
    font.aliases.forEach((alias) => {
      code = changeResource(rollupCtx, ctx, code, {
        alias,
        name: font.name,
        // TODO: recheck it
        sid: font.options.sid,
      });
    });
  }
  return code;
}

function processGoogleFontUrl(
  rollupCtx: TransformPluginContext,
  ctx: PluginContext,
  code: string,
  id: string,
  font: GoogleFontMeta,
): string {
  checkFontProcessing(ctx, font.name, id);
  const oldText = font.url.searchParams.get("text");
  if (oldText) {
    ctx.logger.warn(`Font [${font.name}] in ${id} has duplicated logic for minification`);
  }
  const text = [oldText, ...(font.options.target.ligatures ?? [])].filter(exists).join(" ");
  const originalUrl = font.url.toString();
  const fixedUrl = new URL(originalUrl);
  fixedUrl.searchParams.set("text", text);
  return code.replace(originalUrl, fixedUrl.toString());
}

export async function transformHook(
  rollupCtx: TransformPluginContext,
  ctx: PluginContext,
  code: string,
  id: string,
): Promise<string> {
  ctx.logger.fix();

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
    const googleFonts = extractGoogleFontsUrls(code)
      .map<GoogleFontMeta | null>((raw) => {
        const url = new URL(raw);
        const name = url.searchParams.get("family");
        if (ctx.pluginOption.ignore?.includes(name!)) {
          return null;
        }
        if (!name) {
          ctx.logger.warn(`No specified google font name in ${styler.path(id)}`);
          return null;
        }
        if (name.includes("|")) {
          // TODO: add extracting font url with minification
          ctx.logger.warn("Google font url includes multiple families. Not supported");
          return null;
        }

        const options = ctx.optionsMap.get(name);
        if (!options) {
          ctx.logger.warn(`Font "${name}" has no minify options`);
          return null;
        }

        return { name, options, url };
      })
      .filter(exists);

    for (const font of googleFonts) {
      try {
        code = processGoogleFontUrl(rollupCtx, ctx, code, id, font);
      } catch (e) {
        ctx.logger.error(`Process ${font.name} Google font is failed`, { error: e as Error });
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
          ctx.logger.warn(`Font "${name}" has no minify options`);
          return null;
        }

        const aliases = extractFonts(face);

        const urlSources = aliases.filter((alias) => alias.startsWith("http"));
        if (urlSources.length) {
          ctx.logger.warn(`Font "${name}" has external url sources: ${urlSources.toString()}`);
          return null;
        }

        return { name, face, aliases, options };
      })
      .filter(exists);
    for (const font of fonts) {
      try {
        code = await processFont(rollupCtx, ctx, code, id, font);
      } catch (e) {
        ctx.logger.error(`Process ${font.name} local font is failed`, { error: e as Error });
      }
    }
  }
  return code;
}
