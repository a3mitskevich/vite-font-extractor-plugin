import { getFontExtension, hasDifferent } from "./utils";
import type { PluginContext } from "./context";
import type { ServeFontStubResponse } from "./types";
import { processMinify } from "./minify";

export function processServeFontMinify(
  ctx: PluginContext,
  id: string,
  url: string,
  fontName: string,
): () => Promise<ServeFontStubResponse | null> {
  let result: ServeFontStubResponse | null = null;
  let prevOptions = ctx.optionsMap.get(fontName);

  return async (): Promise<ServeFontStubResponse | null> => {
    const currentOptions = ctx.optionsMap.get(fontName);
    if (currentOptions && (!result || currentOptions.sid !== prevOptions?.sid)) {
      prevOptions = currentOptions;
      const extension = getFontExtension(url);
      const minifiedBuffers = await processMinify(
        ctx,
        fontName,
        [{ url, importer: id, extension }],
        currentOptions,
      );
      const content = minifiedBuffers?.[extension];
      if (content) {
        result = { content, extension, id };
      } else {
        result = null;
      }
    }
    return result;
  };
}

export function processServeAutoFontMinify(
  ctx: PluginContext,
  id: string,
  url: string,
  fontName: string,
): () => Promise<ServeFontStubResponse | null> {
  let previousRaws = ctx.autoProxyOption.target.raws ?? [];
  let result: ServeFontStubResponse | null;

  return async (): Promise<ServeFontStubResponse | null> => {
    const currentRaws = ctx.autoProxyOption.target.raws ?? [];
    if (!result || hasDifferent(previousRaws, currentRaws)) {
      previousRaws = currentRaws;
      const extension = getFontExtension(url);
      const minifiedBuffers = await processMinify(
        ctx,
        fontName,
        [{ url, importer: id, extension }],
        ctx.autoProxyOption,
      );
      const content = minifiedBuffers?.[extension];
      if (content) {
        result = { content, extension, id };
      } else {
        result = null;
      }
    }
    return result;
  };
}
