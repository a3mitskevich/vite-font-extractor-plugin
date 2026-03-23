import { extract, type ExtractedResult } from "fontext";
import type { MinifyFontOptions, OptionsWithCacheSid } from "./types";
import { camelCase, getHash } from "./utils";
import { readFileSync } from "node:fs";
import { SUPPORT_START_FONT_REGEX, SUPPORTED_RESULTS_FORMATS } from "./constants";
import styler from "./styler";
import type { PluginContext } from "./context";

export async function getSourceByUrl(
  ctx: PluginContext,
  url: string,
  importer?: string,
): Promise<Buffer | null> {
  const entrypointFilePath = await ctx.importResolvers.font(url, importer);

  if (!entrypointFilePath) {
    ctx.logger.warn(`Can not resolve entrypoint font by url: ${styler.path(url)}`);
    return null;
  }

  return readFileSync(entrypointFilePath);
}

export async function processMinify(
  ctx: PluginContext,
  fontName: string,
  fonts: MinifyFontOptions[],
  options: OptionsWithCacheSid,
): Promise<ExtractedResult | null> {
  const unsupportedFont = fonts.find((font) => !SUPPORTED_RESULTS_FORMATS.includes(font.extension));
  if (unsupportedFont) {
    ctx.logger.error(
      `Font face has unsupported extension - ${unsupportedFont.extension ?? "undefined"}`,
    );
    return null;
  }

  const entryPoint = fonts.find((font) => SUPPORT_START_FONT_REGEX.test(font.extension));

  if (!entryPoint) {
    ctx.logger.error("No find supported fonts file extensions for extracting process");
    return null;
  }

  const sid = options.sid;
  const cacheKey = camelCase(fontName) + "-" + getHash(sid + entryPoint.url);

  const needExtracting = fonts.some((font) => !ctx.cache?.check(cacheKey + `.${font.extension}`));

  const minifiedBuffers: ExtractedResult = {
    meta: [],
    report: { originalSize: 0, formats: {} },
  };

  if (needExtracting) {
    if (ctx.cache) {
      ctx.logger.info(`Clear cache for ${fontName} because some files have a different content`);
      ctx.cache.clearCache(fontName);
    }

    const source =
      entryPoint.source ?? (await getSourceByUrl(ctx, entryPoint.url, entryPoint.importer));

    if (!source) {
      ctx.logger.error(`No found source for ${fontName}:${styler.path(entryPoint.url)}`);
      return null;
    }

    const minifyResult = await extract(Buffer.from(source), {
      fontName,
      formats: fonts.map((font) => font.extension),
      raws: options.target.raws,
      ligatures: options.target.ligatures,
      withWhitespace: options.target.withWhitespace,
    });
    Object.assign(minifiedBuffers, minifyResult);

    if (ctx.cache) {
      fonts.forEach((font) => {
        const minifiedBuffer = minifyResult[font.extension];
        if (minifiedBuffer) {
          ctx.logger.info(`Save a minified buffer for ${fontName} to cache`);
          ctx.cache!.set(cacheKey + `.${font.extension}`, minifiedBuffer);
        }
      });
    }
  } else {
    ctx.logger.info(`Get minified fonts from cache for ${fontName}`);
    const cacheResult = Object.fromEntries(
      fonts.map((font) => [font.extension, ctx.cache!.get(cacheKey + `.${font.extension}`)]),
    );
    Object.assign(minifiedBuffers, cacheResult);
  }

  return minifiedBuffers;
}

export function checkFontProcessing(ctx: PluginContext, name: string, id: string): void | never {
  const duplicateId = ctx.progress.get(name);

  if (duplicateId && !ctx.isServe) {
    const placeInfo = `Font placed in "${styler.path(id)}" and "${styler.path(duplicateId)}"`;
    const errorMessage = `Plugin not support a multiply files with same font name [${name}]. ${placeInfo}`;
    // TODO: have chance to conflict by `unicode-range` attribute. Fix it
    ctx.logger.error(errorMessage);
    throw new Error(errorMessage);
  } else {
    ctx.progress.set(name, id);
  }
}
