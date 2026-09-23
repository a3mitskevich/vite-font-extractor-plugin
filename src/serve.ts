import { type Connect, send, type ViteDevServer } from "vite";
import { cleanUrl, createSubsetOptions, getFontExtension, toError } from "./utils";
import { type PluginContext, getLogger } from "./context";
import type {
  MinifyFontOptions,
  OptionsWithCacheSid,
  ServeFontStubResponse,
  SubsetOptions,
} from "./types";
import { processMinify } from "./minify";
import { SUPPORT_START_FONT_REGEX } from "./constants";
import { mergeSubsetOptions, parseUrlSubset } from "./subset-options";
import styler from "./styler";

export type ServeFontLoader = () => Promise<ServeFontStubResponse | null>;

export interface ServeFontRequest {
  // Module that declares the @font-face
  importer: string;
  // Font url without base, may carry a query (`?v=`, `?subset=`)
  url: string;
  // Other local urls of the same @font-face, without base
  aliases: string[];
  fontName: string;
  auto: boolean;
}

function resolveServeOptions(
  ctx: PluginContext,
  request: ServeFontRequest,
  subset: SubsetOptions | undefined,
): OptionsWithCacheSid | null {
  if (request.auto) {
    // Nothing to extract until auto mode finds glyphs — the original is served meanwhile
    return ctx.autoProxyOption.target.raws?.length ? ctx.autoProxyOption : null;
  }
  const options = ctx.optionsMap.get(request.fontName);
  if (options) {
    return mergeSubsetOptions(options, subset);
  }
  // A face without target options is minified by its `?subset=` alone, like in build
  return subset ? createSubsetOptions(request.fontName, subset) : null;
}

// EOT and SVG can not be a minification source — another format of the @font-face is used
function collectServeFonts(request: ServeFontRequest): MinifyFontOptions[] {
  const url = cleanUrl(request.url);
  const requested = { url, importer: request.importer, extension: getFontExtension(url) };
  if (SUPPORT_START_FONT_REGEX.test(requested.extension)) {
    return [requested];
  }
  const source = request.aliases
    .map(cleanUrl)
    .find((alias) => SUPPORT_START_FONT_REGEX.test(getFontExtension(alias)));
  return source
    ? [requested, { url: source, importer: request.importer, extension: getFontExtension(source) }]
    : [requested];
}

async function minifyForServe(
  ctx: PluginContext,
  request: ServeFontRequest,
  fonts: MinifyFontOptions[],
  options: OptionsWithCacheSid,
): Promise<ServeFontStubResponse | null> {
  const [{ extension }] = fonts;
  try {
    const content = (await processMinify(ctx, request.fontName, fonts, options))?.[extension];
    return content ? { content, extension, id: request.importer } : null;
  } catch (e) {
    const error = toError(e);
    getLogger(ctx).error(
      `Failed to minify "${request.fontName}" (${styler.path(request.url)}), serving the original: ${error.message}`,
      { error },
    );
    return null;
  }
}

// Minifies lazily on request; the result is reused until the font options change
export function createServeFontLoader(
  ctx: PluginContext,
  request: ServeFontRequest,
): ServeFontLoader {
  const fonts = collectServeFonts(request);
  const subset = parseUrlSubset(request.url);
  let resultSid: string | undefined;
  let result: ServeFontStubResponse | null = null;

  return async () => {
    const options = resolveServeOptions(ctx, request, subset);
    if (!options) {
      return null;
    }
    if (options.sid !== resultSid) {
      resultSid = options.sid;
      result = await minifyForServe(ctx, request, fonts, options);
    }
    return result;
  };
}

// Serves minified fonts; on a miss or any failure Vite serves the original file
export function createServeMiddleware(
  ctx: PluginContext,
  server: ViteDevServer,
): Connect.NextHandleFunction {
  const inFlightRequests = new Map<string, Promise<ServeFontStubResponse | null>>();
  const load = (url: string, loader: ServeFontLoader): Promise<ServeFontStubResponse | null> => {
    const pending = inFlightRequests.get(url);
    if (pending) return pending;
    const request = loader().finally(() => inFlightRequests.delete(url));
    inFlightRequests.set(url, request);
    return request;
  };
  const logFailure = (url: string, e: unknown): void => {
    const error = toError(e);
    getLogger(ctx).error(`Failed to process font ${styler.path(url)}: ${error.message}`, { error });
  };

  return (req, res, next) => {
    const url = req.url;
    const loader = url ? ctx.fontServeProxy.get(url) : undefined;
    if (!url || !loader) {
      next();
      return;
    }
    load(url, loader)
      .then(
        (stub) => {
          if (!stub) {
            next();
            return;
          }
          getLogger(ctx).fix();
          getLogger(ctx).info(`Stub server response for: ${styler.path(url)}`);
          send(req, res, stub.content, `font/${stub.extension}`, {
            cacheControl: "no-cache",
            headers: server.config.server.headers,
            etag: "",
          });
          ctx.loadedAutoFontMap.set(url, true);
        },
        (error: unknown) => {
          logFailure(url, error);
          next();
        },
      )
      .catch((error: unknown) => logFailure(url, error));
  };
}
