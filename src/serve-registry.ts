import type { PluginContext } from "./context";
import {
  createServeFontLoader,
  reloadAutoFonts,
  type ServeFontLoader,
  type ServeFontRequest,
} from "./serve";
import { cleanUrl } from "./utils";

// Dev: the font urls the last transform of a module registered with the middleware
export interface ServedModule {
  readonly urls: Map<string, ServeFontLoader>;
  // Loaders by request: the plain and the tagged url of a face share one minification
  readonly loaders: Map<string, ServeFontLoader>;
  // Loaders of the previous transform, reused while a face keeps its request
  readonly previous: Map<string, ServeFontLoader>;
}

const createServedModule = (previous = new Map<string, ServeFontLoader>()): ServedModule => ({
  urls: new Map(),
  loaders: new Map(),
  previous,
});

// Unregisters the urls of the module; another module that registered a url since keeps it
function releaseUrls(ctx: PluginContext, served: ServedModule): void {
  for (const [url, loader] of served.urls) {
    if (ctx.fontServeProxy.get(url) === loader) ctx.fontServeProxy.delete(url);
  }
}

/**
 * The module is transformed again: its stylesheet may have renamed a face, changed its sources
 * or its family, so the urls of the previous transform are dropped and registered anew.
 */
export function beginServeTransform(ctx: PluginContext, id: string): void {
  const served = ctx.servedModules.get(id);
  if (served) releaseUrls(ctx, served);
  ctx.servedModules.set(id, createServedModule(served?.loaders));
  ctx.autoFaceModules.delete(id);
}

// Options by identity: the auto target is live (never serialize it, its fontName throws), a
// target is its sid
const toRequestKey = ({ options, ...request }: ServeFontRequest): string =>
  JSON.stringify({ ...request, options: options.auto ? "auto" : options.sid });

/**
 * Registers a font url of a face with the middleware. Within one transform the first face keeps
 * a url (a plain url shared by several families is served for the first of them); a later
 * transform of any module that declares the url wins over older ones.
 */
export function registerServeUrl(
  ctx: PluginContext,
  id: string,
  url: string,
  request: ServeFontRequest,
): void {
  const served = ctx.servedModules.get(id) ?? createServedModule();
  ctx.servedModules.set(id, served);
  if (served.urls.has(url)) return;
  const key = toRequestKey(request);
  const loader =
    served.loaders.get(key) ?? served.previous.get(key) ?? createServeFontLoader(ctx, request);
  served.loaders.set(key, loader);
  served.urls.set(url, loader);
  ctx.fontServeProxy.set(url, loader);
}

// The module is gone: nothing of it is served or reloaded anymore
export function forgetServeModule(ctx: PluginContext, id: string): void {
  const served = ctx.servedModules.get(id);
  if (served) releaseUrls(ctx, served);
  ctx.servedModules.delete(id);
  ctx.autoFaceModules.delete(id);
}

/**
 * Dev: a file changed on disk. The urls its modules registered are dropped until they are
 * transformed again; a deleted file also takes its auto-mode glyphs away.
 */
export function onServedFileChange(
  ctx: PluginContext,
  file: string,
  event: "create" | "update" | "delete",
): void {
  const ids = [...ctx.servedModules.keys(), ...ctx.glyphsFindMap.keys()].filter(
    (id) => cleanUrl(id) === file,
  );
  if (!ids.length) return;
  const sidBefore = ctx.mode === "auto" ? ctx.autoProxyOption.sid : "";
  for (const id of new Set(ids)) {
    if (event !== "delete") {
      const served = ctx.servedModules.get(id);
      if (served) releaseUrls(ctx, served);
      continue;
    }
    forgetServeModule(ctx, id);
    ctx.glyphsFindMap.delete(id);
  }
  if (ctx.mode === "auto" && ctx.autoProxyOption.sid !== sidBefore) reloadAutoFonts(ctx, file);
}
