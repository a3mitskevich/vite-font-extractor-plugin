import type { Target } from "./types";
import { type PluginContext, getLogger } from "./context";
import { GOOGLE_FONT_URL_RE, HAS_GOOGLE_FONT_URL_RE } from "./constants";
import { getGoogleFontFamilies, getGoogleFontText, setGoogleFontText } from "./google-fonts";
import { checkFontProcessing } from "./minify";
import styler from "./styler";
import { exists, extractGoogleFontsUrls, stripCssComments, toError } from "./utils";

export const hasGoogleFontUrl = (code: string): boolean => HAS_GOOGLE_FONT_URL_RE.test(code);

// Everything a target keeps: ligature names, raw glyphs and characters
function getTargetTexts(target: Target): string[] {
  const characters = "characters" in target ? target.characters : undefined;
  const raws = "raws" in target ? target.raws : undefined;
  return [...(target.ligatures ?? []), ...(raws ?? []), characters].filter(
    (text): text is string => !!text,
  );
}

function getFamilyTexts(ctx: PluginContext, name: string, id: string): string[] {
  if (ctx.pluginOption.ignore?.includes(name)) return [];
  const options = ctx.optionsMap.get(name);
  if (!options) {
    getLogger(ctx).warn(`Font "${name}" has no minify options`);
    return [];
  }
  checkFontProcessing(ctx, name, id);
  // Auto mode: Google subsets by characters, so the letters of a ligature keep it working
  return options.auto ? getTargetTexts(ctx.autoProxyOption.target) : getTargetTexts(options.target);
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
    const texts = [...new Set(families.flatMap((name) => getFamilyTexts(ctx, name, id)))];
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

// Google Fonts stylesheet urls of HTML or CSS get `text=`; urls inside comments are left as is
export function rewriteGoogleFontUrls(ctx: PluginContext, code: string, id: string): string {
  const urls = new Set(extractGoogleFontsUrls(stripCssComments(code)));
  return code.replace(GOOGLE_FONT_URL_RE, (raw) =>
    urls.has(raw) ? processGoogleFontUrl(ctx, raw, id) : raw,
  );
}
