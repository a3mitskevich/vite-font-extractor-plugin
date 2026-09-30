import type { OptionsWithCacheSid } from "./types";
import { type PluginContext, getLogger } from "./context";
import { hasSubsetParam } from "./subset-options";
import { createSubsetOptions } from "./utils";

const REMOTE_URL_RE = /^(?:https?:)?\/\//i;

export const isRemoteUrl = (url: string): boolean => REMOTE_URL_RE.test(url);

export interface FaceOptionsRequest {
  family: string;
  urls: string[];
  // The final (compiled CSS) pass reports faces it can not minify; earlier passes stay silent
  report: boolean;
}

/**
 * Options to minify an @font-face with: its target, or its `?subset=` alone. null when the face
 * is ignored, has nothing to minify it with, or loads from another host.
 */
export function resolveFaceOptions(
  ctx: PluginContext,
  { family, urls, report }: FaceOptionsRequest,
): OptionsWithCacheSid | null {
  const logger = getLogger(ctx);
  if (!family || ctx.pluginOption.ignore?.includes(family)) {
    logger.debug(() => (family ? `options: "${family}" is ignored` : "options: no font-family"));
    return null;
  }
  const options = ctx.optionsMap.get(family);
  if (!options) {
    if (urls.some(hasSubsetParam)) {
      logger.debug(`options: "${family}" has no target, minified by its ?subset=`);
      return createSubsetOptions(family, {});
    }
    logger.debug(`options: "${family}" has no target and no ?subset= — not minified`);
    if (report)
      logger.warn(`Font "${family}" has no minify options — add to targets or use ?subset=`);
    return null;
  }
  const remote = urls.filter(isRemoteUrl);
  if (remote.length) {
    logger.debug(
      () => `options: "${family}" has remote urls (${remote.join(", ")}) — not minified`,
    );
    if (report) logger.warn(`Font "${family}" has external url sources: ${remote.toString()}`);
    return null;
  }
  logger.debug(() => `options: "${family}" → ${options.auto ? "auto glyphs" : "target"}`);
  if (report && options.auto) {
    logger.warn(
      `"auto" mode detected. "${family}" font is stubbed based on auto-detected glyphs.` +
        " If this font is not a target please add it to ignore.",
    );
  }
  return options;
}
