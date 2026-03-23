import { extract, type ExtractedResult } from "fontext";
import type { MinifyFontOptions, OptionsWithCacheSid } from "./types";
import { camelCase, getHash } from "./utils";
import { readFileSync } from "node:fs";
import { SUPPORT_START_FONT_REGEX, SUPPORTED_RESULTS_FORMATS } from "./constants";
import styler from "./styler";
import { type PluginContext, getLogger, getResolvers } from "./context";

export async function getSourceByUrl(
  ctx: PluginContext,
  url: string,
  importer?: string,
): Promise<Buffer | null> {
  const resolvers = getResolvers(ctx);
  const logger = getLogger(ctx);
  const entrypointFilePath = await resolvers.font(url, importer);

  if (!entrypointFilePath) {
    logger.warn(`Can not resolve entrypoint font by url: ${styler.path(url)}`);
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
  const logger = getLogger(ctx);

  const unsupportedFont = fonts.find((font) => !SUPPORTED_RESULTS_FORMATS.includes(font.extension));
  if (unsupportedFont) {
    logger.error(
      `Font face has unsupported extension - ${unsupportedFont.extension ?? "undefined"}`,
    );
    return null;
  }

  const entryPoint = fonts.find((font) => SUPPORT_START_FONT_REGEX.test(font.extension));

  if (!entryPoint) {
    logger.error("No find supported fonts file extensions for extracting process");
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
      ctx.cache.clearCache(fontName);
    }

    const source =
      entryPoint.source ?? (await getSourceByUrl(ctx, entryPoint.url, entryPoint.importer));

    if (!source) {
      logger.error(`No found source for ${fontName}:${styler.path(entryPoint.url)}`);
      return null;
    }

    const minifyResult = await extract(Buffer.from(source), {
      fontName,
      formats: fonts.map((font) => font.extension),
      raws: options.target.raws,
      ligatures: options.target.ligatures,
      withWhitespace: options.target.withWhitespace,
      characters: options.target.characters,
      unicodeRanges: options.target.unicodeRanges,
      engine: options.target.engine,
    });
    Object.assign(minifiedBuffers, minifyResult);

    if (ctx.cache) {
      fonts.forEach((font) => {
        const minifiedBuffer = minifyResult[font.extension];
        if (minifiedBuffer) {
          ctx.cache!.set(cacheKey + `.${font.extension}`, minifiedBuffer);
        }
      });
    }
  } else {
    logger.cached(fontName);
    const cacheResult = Object.fromEntries(
      fonts.map((font) => [font.extension, ctx.cache!.get(cacheKey + `.${font.extension}`)]),
    );
    Object.assign(minifiedBuffers, cacheResult);
  }

  return minifiedBuffers;
}

export function checkFontProcessing(ctx: PluginContext, name: string, id: string): void {
  const existingId = ctx.progress.get(name);

  if (existingId && existingId !== id && !ctx.isServe) {
    getLogger(ctx).warn(
      `Font "${name}" found in multiple files: "${styler.path(existingId)}" and "${styler.path(id)}". Both will be processed.`,
    );
  }
  ctx.progress.set(name, id);
}
