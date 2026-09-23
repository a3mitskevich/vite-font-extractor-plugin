import { extract, type ExtractedResult, type MinifyOption } from "fontext";
import type { MinifyFontOptions, OptionsWithCacheSid, Target } from "./types";
import { camelCase, getHash } from "./utils";
import { readFile } from "node:fs/promises";
import { SUPPORT_START_FONT_REGEX, SUPPORTED_RESULTS_FORMATS } from "./constants";
import styler from "./styler";
import type Cache from "./cache";
import { type PluginContext, getLogger, getResolvers } from "./context";

const SHA256_HEX_LENGTH = 64;

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

  return readFile(entrypointFilePath);
}

function createExtractOption(
  fontName: string,
  fonts: MinifyFontOptions[],
  target: Target,
): MinifyOption {
  const formats = fonts.map((font) => font.extension);
  const base = { fontName, formats, safariFix: target.safariFix, silent: target.silent };
  return target.engine === "subset"
    ? {
        ...base,
        engine: "subset",
        characters: target.characters,
        ligatures: target.ligatures,
        unicodeRanges: target.unicodeRanges,
        withWhitespace: target.withWhitespace,
      }
    : {
        ...base,
        engine: target.engine,
        raws: target.raws,
        ligatures: target.ligatures,
        unicodeRanges: target.unicodeRanges,
        withWhitespace: target.withWhitespace,
      };
}

async function hasCachedFormats(
  cache: Cache,
  cacheKey: string,
  fonts: MinifyFontOptions[],
): Promise<boolean> {
  const checks = await Promise.all(
    fonts.map((font) => cache.check(`${cacheKey}.${font.extension}`)),
  );
  return checks.every(Boolean);
}

async function readCachedFormats(
  cache: Cache,
  cacheKey: string,
  fonts: MinifyFontOptions[],
): Promise<Partial<ExtractedResult>> {
  const entries = await Promise.all(
    fonts.map(async (font) => [font.extension, await cache.get(`${cacheKey}.${font.extension}`)]),
  );
  return Object.fromEntries(entries);
}

async function writeCachedFormats(
  cache: Cache,
  cacheKey: string,
  fonts: MinifyFontOptions[],
  result: ExtractedResult,
): Promise<void> {
  await Promise.all(
    fonts.map((font) => {
      const buffer = result[font.extension];
      return buffer ? cache.set(`${cacheKey}.${font.extension}`, buffer) : undefined;
    }),
  );
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

  const source =
    entryPoint.source ?? (await getSourceByUrl(ctx, entryPoint.url, entryPoint.importer));

  if (!source) {
    logger.error(`No found source for ${fontName}:${styler.path(entryPoint.url)}`);
    return null;
  }

  // Source content is part of the key: an updated font file must not hit a stale entry
  const sourceHash = getHash(source, SHA256_HEX_LENGTH);
  const cacheKey = camelCase(fontName) + "-" + getHash(options.sid + sourceHash);
  const emptyResult: ExtractedResult = { meta: [], report: { originalSize: 0, formats: {} } };

  if (ctx.cache && (await hasCachedFormats(ctx.cache, cacheKey, fonts))) {
    logger.cached(fontName);
    return { ...emptyResult, ...(await readCachedFormats(ctx.cache, cacheKey, fonts)) };
  }

  const extractOption = createExtractOption(fontName, fonts, options.target);
  const minifyResult = await extract(Buffer.from(source), extractOption);
  if (ctx.cache) {
    await writeCachedFormats(ctx.cache, cacheKey, fonts, minifyResult);
  }
  return { ...emptyResult, ...minifyResult };
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
