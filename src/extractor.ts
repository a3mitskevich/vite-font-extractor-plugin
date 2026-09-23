import type { Plugin } from "vite";
import { isAbsolute } from "node:path";
import type { PluginOption } from "./types";
import Cache from "./cache";
import { createResolvers, intersection, mergePath } from "./utils";
import { PLUGIN_NAME, TRANSFORM_ID_INCLUDE } from "./constants";
import { createInternalLogger } from "./internal-logger";
import { createPluginContext } from "./context";
import { transformHook } from "./transform";
import { generateBundleHook } from "./bundle";
import { createServeMiddleware } from "./serve";

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
      logger.banner();

      const cacheStatus = pluginOption.cache ? "cache enabled" : "no cache";
      const targetCount = ctx.targets.length;
      logger.config(
        ctx.mode,
        `${targetCount} target${targetCount !== 1 ? "s" : ""}, ${cacheStatus}`,
      );

      const intersectionIgnoreWithTargets = intersection(
        pluginOption.ignore ?? [],
        ctx.targets.map((target) => target.fontName),
      );
      if (intersectionIgnoreWithTargets.length) {
        logger.warn(`Ignore overlaps with targets: ${intersectionIgnoreWithTargets.toString()}`);
      }

      ctx.importResolvers = createResolvers(config);
      ctx.base = config.base;

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
      server.middlewares.use(createServeMiddleware(ctx, server));
    },
    // Vite 6+: fonts are emitted by the client build only
    applyToEnvironment(environment) {
      return environment.config.consumer === "client";
    },
    buildStart() {
      ctx.cache?.resetUsage();
    },
    transform: {
      filter: { id: { include: TRANSFORM_ID_INCLUDE } },
      async handler(code, id, options) {
        // Filters are ignored before Vite 6.3, and applyToEnvironment before Vite 6
        if (options?.ssr || !TRANSFORM_ID_INCLUDE.some((re) => re.test(id))) {
          return null;
        }
        const result = await transformHook(ctx, code, id);
        return result === code ? null : result;
      },
    },
    async generateBundle(_, bundle) {
      return generateBundleHook(this.getFileName.bind(this), this.emitFile.bind(this), ctx, bundle);
    },
  };
}
