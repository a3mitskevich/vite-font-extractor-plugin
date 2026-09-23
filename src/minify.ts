import { extract, type ExtractedResult, type MinifyOption } from "fontext";
import type {
  IconTarget,
  InternalLogger,
  MinifyFontOptions,
  OptionsWithCacheSid,
  Target,
} from "./types";
import { camelCase, getHash } from "./utils";
import { readFile } from "node:fs/promises";
import { SUPPORT_START_FONT_REGEX, SUPPORTED_RESULTS_FORMATS } from "./constants";
import styler from "./styler";
import type Cache from "./cache";
import { type PluginContext, getLogger, getResolvers } from "./context";
import { checkIconGlyphs, formatGlyphs, type IconGlyphs, splitGlyphTexts } from "./glyph-filter";

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
  glyphs?: IconGlyphs,
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
        raws: glyphs?.raws ?? target.raws,
        ligatures: glyphs?.ligatures ?? target.ligatures,
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

// Auto mode collects content glyphs of all CSS, most of them belong to other fonts
function resolveAutoGlyphs(
  logger: InternalLogger,
  fontName: string,
  source: Buffer,
  target: IconTarget,
): IconGlyphs | null | undefined {
  const texts = [...(target.raws ?? []), ...(target.ligatures ?? [])];
  const check = checkIconGlyphs(source, splitGlyphTexts(texts));
  if (!check) return undefined;
  if (check.missing.length) {
    logger.info(
      `  Font "${fontName}": skipped glyphs from CSS content not found in the font: ${formatGlyphs(check.missing)}`,
    );
  }
  if (!check.raws.length && !check.ligatures.length && !target.unicodeRanges?.length) {
    logger.warn(
      `Font "${fontName}" contains none of the glyphs used in CSS content — keeping original.` +
        " Add it to ignore if it is not an icon font.",
    );
    return null;
  }
  return check;
}

// fontext rejects the whole font for a raw glyph it can not resolve — name every such glyph
function assertTargetRaws(fontName: string, source: Buffer, target: IconTarget): void {
  const check = checkIconGlyphs(source, { raws: target.raws ?? [], ligatures: [] });
  if (check?.missing.length) {
    throw new Error(
      `Target "${fontName}": raws ${formatGlyphs(check.missing)} are not icon glyphs of the font.` +
        " Remove them or use unicodeRanges.",
    );
  }
}

/**
 * Glyphs to pass instead of the target ones: undefined keeps the target as is,
 * null means there is nothing to extract.
 */
function resolveIconGlyphs(
  logger: InternalLogger,
  fontName: string,
  source: Buffer,
  { auto, target }: OptionsWithCacheSid,
): IconGlyphs | null | undefined {
  if (target.engine === "subset") return undefined;
  if (auto) return resolveAutoGlyphs(logger, fontName, source, target);
  if (target.raws?.length) assertTargetRaws(fontName, source, target);
  return undefined;
}

const listExtensions = (fonts: MinifyFontOptions[]): string =>
  [...new Set(fonts.map((font) => `.${font.extension}`))].join(", ");

// fontext can not write every format a @font-face may list (otf) — such files stay as they are
function selectOutputFormats(
  logger: InternalLogger,
  fontName: string,
  fonts: MinifyFontOptions[],
): MinifyFontOptions[] {
  const isSupported = (font: MinifyFontOptions): boolean =>
    SUPPORTED_RESULTS_FORMATS.includes(font.extension);
  const unsupported = fonts.filter((font) => !isSupported(font));
  if (unsupported.length) {
    const extensions = listExtensions(unsupported);
    logger.warn(
      `Font "${fontName}": ${extensions} is not supported for minification — keeping original ${extensions}`,
    );
  }
  return fonts.filter(isSupported);
}

// Any readable file is a source, even one whose format can not be written back
async function readSource(
  ctx: PluginContext,
  fontName: string,
  fonts: MinifyFontOptions[],
): Promise<Buffer | string | null> {
  const logger = getLogger(ctx);
  const entryPoint = fonts.find((font) => SUPPORT_START_FONT_REGEX.test(font.extension));
  if (!entryPoint) {
    logger.warn(
      `Font "${fontName}": ${listExtensions(fonts)} can not be read for minification — keeping original.` +
        " Add a woff2, woff, ttf or otf source.",
    );
    return null;
  }
  const source =
    entryPoint.source ?? (await getSourceByUrl(ctx, entryPoint.url, entryPoint.importer));
  if (!source) {
    logger.error(`No found source for ${fontName}:${styler.path(entryPoint.url)}`);
  }
  return source;
}

export async function processMinify(
  ctx: PluginContext,
  fontName: string,
  fonts: MinifyFontOptions[],
  options: OptionsWithCacheSid,
): Promise<ExtractedResult | null> {
  const logger = getLogger(ctx);

  const outputs = selectOutputFormats(logger, fontName, fonts);
  if (!outputs.length) {
    return null;
  }
  const source = await readSource(ctx, fontName, fonts);
  if (!source) {
    return null;
  }

  // Source content is part of the key: an updated font file must not hit a stale entry
  const sourceHash = getHash(source, SHA256_HEX_LENGTH);
  const cacheKey = camelCase(fontName) + "-" + getHash(options.sid + sourceHash);
  const emptyResult: ExtractedResult = { meta: [], report: { originalSize: 0, formats: {} } };

  if (ctx.cache && (await hasCachedFormats(ctx.cache, cacheKey, outputs))) {
    logger.cached(fontName);
    return { ...emptyResult, ...(await readCachedFormats(ctx.cache, cacheKey, outputs)) };
  }

  const sourceBuffer = Buffer.from(source);
  const glyphs = resolveIconGlyphs(logger, fontName, sourceBuffer, options);
  if (glyphs === null) {
    return null;
  }
  const extractOption = createExtractOption(fontName, outputs, options.target, glyphs);
  const minifyResult = await extract(sourceBuffer, extractOption);
  if (ctx.cache) {
    await writeCachedFormats(ctx.cache, cacheKey, outputs, minifyResult);
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
