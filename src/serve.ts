import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { type Connect, isFileLoadingAllowed, normalizePath, send, type ViteDevServer } from "vite";
import { cleanUrl, createSubsetOptions, getFontExtension, stripBase, toError } from "./utils";
import { type PluginContext, getLogger } from "./context";
import type {
  MinifyFontOptions,
  OptionsWithCacheSid,
  ServeFontStubResponse,
  SubsetOptions,
} from "./types";
import { processMinify } from "./minify";
import { FONT_MIME_TYPES, SUPPORT_START_FONT_REGEX } from "./constants";
import { mergeSubsetOptions, parseUrlSubset } from "./subset-options";
import styler from "./styler";
import { splitUrl } from "./font-emit";
import { forgetServeModule } from "./serve-registry";

// A font requested with `?subset=`, other params may come first
const SUBSET_REQUEST_RE = /\.(?:woff2?|ttf|otf|eot)\?(?:[^#]*&)?subset=/i;
// Module requests of Vite (`import url from './font.woff2?subset=A'` is fetched with `&import`)
const MODULE_REQUEST_RE = /[?&](?:import|url|raw|inline|worker|sharedworker)\b/;
const FS_PREFIX = "/@fs/";
const WINDOWS_DRIVE_RE = /^\/[A-Za-z]:/;
// Every distinct `?subset=` url gets a loader: the oldest ones go past this many
const MAX_SUBSET_REQUESTS = 500;
// Coalesces the reloads of auto-mode fonts while many stylesheets load
const AUTO_RELOAD_DELAY_MS = 50;

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
    // An explicit `?subset=` replaces the detected glyphs, like in build. Without it there is
    // nothing to extract until auto mode finds glyphs — the original is served meanwhile
    if (subset) return mergeSubsetOptions(ctx.autoProxyOption, subset, request.fontName);
    return ctx.autoProxyOption.target.raws?.length ? ctx.autoProxyOption : null;
  }
  const options = ctx.optionsMap.get(request.fontName);
  if (options) {
    return mergeSubsetOptions(options, subset, request.fontName);
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
      result = await minifyForServe(ctx, request, fonts, options);
      // A failure is not remembered: the next request retries, e.g. after the font file is fixed
      resultSid = result ? options.sid : undefined;
    }
    return result;
  };
}

function fileOfRequest(ctx: PluginContext, path: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(stripBase(path, ctx.base));
  } catch {
    return null;
  }
  if (!pathname.startsWith(FS_PREFIX)) return normalizePath(resolve(ctx.root, `.${pathname}`));
  const file = pathname.slice(FS_PREFIX.length - 1);
  return normalizePath(resolve(WINDOWS_DRIVE_RE.test(file) ? file.slice(1) : file));
}

/**
 * Dev: a font requested with `?subset=` that no @font-face registered — a JS import or
 * `new URL()`. Vite serves its asset url with the query, the plugin minifies it like build.
 */
function registerSubsetRequest(
  ctx: PluginContext,
  url: string,
  registered: Set<string>,
): ServeFontLoader | undefined {
  if (!SUBSET_REQUEST_RE.test(url) || MODULE_REQUEST_RE.test(url)) return undefined;
  const { path, query } = splitUrl(url);
  const file = fileOfRequest(ctx, path);
  // Only files Vite itself would serve (server.fs.allow / deny)
  if (!file || !ctx.server || !isFileLoadingAllowed(ctx.server.config, file)) return undefined;
  if (!existsSync(file)) return undefined;
  const loader = createServeFontLoader(ctx, {
    importer: file,
    url: file + query,
    aliases: [],
    fontName: `subset (${basename(file)})`,
    auto: false,
  });
  ctx.fontServeProxy.set(url, loader);
  registered.add(url);
  // Evicted in insertion order; a url requested again is registered again
  for (const oldest of registered) {
    if (registered.size <= MAX_SUBSET_REQUESTS) break;
    registered.delete(oldest);
    ctx.fontServeProxy.delete(oldest);
  }
  getLogger(ctx).debug(`dev: ?subset= request registered`, url);
  return loader;
}

/**
 * Dev, auto mode: the glyphs of a stylesheet changed, so the fonts of auto @font-face rules change
 * too. Their modules are transformed again with the new glyph version in the font urls, and HMR
 * sends the stylesheets to the browser, which then loads the new fonts.
 */
export function reloadAutoFonts(ctx: PluginContext, changedId: string): void {
  const server = ctx.server;
  if (!server) return;
  if (ctx.autoReloadTimer) clearTimeout(ctx.autoReloadTimer);
  ctx.autoReloadTimer = setTimeout(() => {
    ctx.autoReloadTimer = null;
    const environment = server.environments.client;
    for (const id of ctx.autoFaceModules) {
      if (id === changedId) continue;
      const module = environment.moduleGraph.getModuleById(id);
      if (!module) {
        forgetServeModule(ctx, id);
        continue;
      }
      environment.moduleGraph.invalidateModule(module);
      environment.reloadModule(module).catch((error: unknown) => {
        getLogger(ctx).error(`Failed to reload ${styler.path(id)}: ${toError(error).message}`);
      });
    }
  }, AUTO_RELOAD_DELAY_MS);
}

// Serves minified fonts; on a miss or any failure Vite serves the original file
export function createServeMiddleware(
  ctx: PluginContext,
  server: ViteDevServer,
): Connect.NextHandleFunction {
  const inFlightRequests = new Map<string, Promise<ServeFontStubResponse | null>>();
  // `?subset=` urls outside @font-face; @font-face urls in fontServeProxy are never evicted
  const subsetRequests = new Set<string>();
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
    const loader = url
      ? (ctx.fontServeProxy.get(url) ?? registerSubsetRequest(ctx, url, subsetRequests))
      : undefined;
    if (!url || !loader) {
      next();
      return;
    }
    load(url, loader)
      .then(
        (stub) => {
          if (!stub) {
            getLogger(ctx).debug("dev: no minified result — original served", url);
            next();
            return;
          }
          getLogger(ctx).debug(`dev: minified font served (${stub.content.length} B)`, url);
          getLogger(ctx).fix();
          getLogger(ctx).info(`Stub server response for: ${styler.path(url)}`);
          // Without `etag` Vite sends a weak one of the content and answers If-None-Match with 304
          send(
            req,
            res,
            stub.content,
            FONT_MIME_TYPES[stub.extension] ?? "application/octet-stream",
            { cacheControl: "no-cache", headers: server.config.server.headers },
          );
        },
        (error: unknown) => {
          logFailure(url, error);
          next();
        },
      )
      .catch((error: unknown) => logFailure(url, error));
  };
}
