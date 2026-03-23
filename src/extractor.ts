import { type Plugin, send } from "vite";
import { isAbsolute } from "node:path";
import type { PluginOption, ServeFontStubResponse } from "./types";
import Cache from "./cache";
import { createResolvers, intersection, mergePath, toError } from "./utils";
import { PLUGIN_NAME } from "./constants";
import styler from "./styler";
import { createInternalLogger } from "./internal-logger";
import { createPluginContext, getLogger } from "./context";
import { transformHook } from "./transform";
import { generateBundleHook } from "./bundle";

export default function FontExtractor(pluginOption: PluginOption = { type: "auto" }): Plugin {
  const ctx = createPluginContext(pluginOption);

  return {
    name: PLUGIN_NAME,
    configResolved(config) {
      ctx.logger = createInternalLogger(
        pluginOption.logLevel ?? config.logLevel,
        config.customLogger,
      );
      const logger = ctx.logger;
      logger.fix();
      logger.info(`Plugin starts in "${ctx.mode}" mode`);

      const intersectionIgnoreWithTargets = intersection(
        pluginOption.ignore ?? [],
        ctx.targets.map((target) => target.fontName),
      );
      if (intersectionIgnoreWithTargets.length) {
        logger.warn(
          `Ignore option has intersection with targets: ${intersectionIgnoreWithTargets.toString()}`,
        );
      }

      ctx.importResolvers = createResolvers(config);

      if (pluginOption.cache) {
        const cachePath =
          (typeof pluginOption.cache === "string" && pluginOption.cache) || "node_modules";
        const resolvedPath = isAbsolute(cachePath) ? cachePath : mergePath(config.root, cachePath);
        ctx.cache = new Cache(resolvedPath);
      } else {
        // Clean up stale cache directory when cache is disabled
        Cache.removeIfExists(mergePath(config.root, "node_modules"));
      }
    },
    configureServer(server) {
      ctx.isServe = true;
      const inFlightRequests = new Map<string, Promise<ServeFontStubResponse | null>>();
      server.middlewares.use((req, res, next) => {
        const url = req.url!;
        const processFn = ctx.fontServeProxy.get(url);
        if (!processFn) {
          next();
        } else {
          const pending =
            inFlightRequests.get(url) ??
            (() => {
              const p = processFn();
              inFlightRequests.set(url, p);
              p.finally(() => inFlightRequests.delete(url));
              return p;
            })();
          const logger = getLogger(ctx);
          pending
            .then((stub) => {
              if (!stub) {
                next();
                return;
              }
              logger.fix();
              logger.info(`Stub server response for: ${styler.path(url)}`);
              send(req, res, stub.content, `font/${stub.extension}`, {
                cacheControl: "no-cache",
                headers: server.config.server.headers,
                etag: "",
              });
              ctx.loadedAutoFontMap.set(url, true);
            })
            .catch((error) => {
              logger.error(`Failed to process font: ${styler.path(url)}`, {
                error: toError(error),
              });
              next(error);
            });
        }
      });
    },
    async transform(code, id) {
      return transformHook(this, ctx, code, id);
    },
    async generateBundle(_, bundle) {
      return generateBundleHook(
        this.getFileName.bind(this),
        this.emitFile.bind(this),
        ctx,
        bundle as any,
      );
    },
  };
}
