import type { OutputAsset, RollupError } from "rollup";
import { basename, dirname } from "node:path";
import type { MinifyFontOptions, MinifyStats, OptionsWithCacheSid } from "./types";
import { getFontExtension, getHash, toError } from "./utils";
import { type PluginContext, getLogger } from "./context";
import { processMinify } from "./minify";

interface EmitAsset {
  type: "asset";
  fileName?: string;
  name?: string;
  source: string | Uint8Array;
}

export async function generateBundleHook(
  getFileName: (referenceId: string) => string,
  emitFile: (file: EmitAsset) => string,
  ctx: PluginContext,
  bundle: Record<string, OutputAsset>,
): Promise<void> {
  if (!ctx.transformMap.size) {
    return;
  }
  const logger = getLogger(ctx);
  logger.fix();

  // Build fileName → asset index once for O(1) lookups
  const assetByFileName = new Map<string, OutputAsset>();
  for (const asset of Object.values(bundle)) {
    if (asset.type === "asset") {
      assetByFileName.set(asset.fileName, asset as OutputAsset);
    }
  }

  // Group reference IDs by font name, collecting the original assets
  const fontGroups = new Map<string, { options: OptionsWithCacheSid; assets: OutputAsset[] }>();

  for (const [key, { fontName, options, subset }] of ctx.transformMap) {
    let asset: OutputAsset | undefined;
    try {
      const fileName = getFileName(key);
      asset = assetByFileName.get(fileName);
    } catch {
      asset = assetByFileName.get(key);
    }

    if (!asset) {
      logger.warn(`Asset not found for key ${key}`);
      continue;
    }

    let mergedOptions = options;
    if (subset) {
      const mergedTarget = {
        ...options.target,
        characters:
          [options.target.characters, subset.characters].filter(Boolean).join("") || undefined,
        unicodeRanges: [...(options.target.unicodeRanges ?? []), ...(subset.unicodeRanges ?? [])]
          .length
          ? [...(options.target.unicodeRanges ?? []), ...(subset.unicodeRanges ?? [])]
          : undefined,
        engine: "subset" as const,
      };
      mergedOptions = { ...options, target: mergedTarget, sid: JSON.stringify(mergedTarget) };
    }

    const group = fontGroups.get(fontName);
    if (group) {
      group.assets.push(asset);
    } else {
      fontGroups.set(fontName, { options: mergedOptions, assets: [asset] });
    }
  }

  const stringAssets = Object.values(bundle).filter(
    (asset): asset is OutputAsset => asset.type === "asset" && typeof asset.source === "string",
  );

  logger.phase("✂ ", "Minify");

  const stats: MinifyStats = { minified: 0, cached: 0, saved: 0 };

  await Promise.all(
    Array.from(fontGroups.entries()).map(async ([fontName, { options, assets }]) => {
      try {
        const minifiedBuffer = await processMinify(
          ctx,
          fontName,
          assets.map<MinifyFontOptions>((asset) => ({
            extension: getFontExtension(asset.fileName),
            source: Buffer.from(asset.source),
            url: "",
          })),
          options,
        );

        logger.found("Font", fontName, `${assets.length} format${assets.length !== 1 ? "s" : ""}`);
        assets.forEach((asset, idx) => {
          const extension = getFontExtension(asset.fileName);
          const originalBuffer = Buffer.from(asset.source);
          const minified = minifiedBuffer?.[extension];
          const isLast = idx === assets.length - 1;

          if (!minified || minified.length === 0 || minified.length >= originalBuffer.length) {
            logger.skipped(fontName, `${extension} not smaller than original`);
            return;
          }

          const oldFileName = asset.fileName;
          const contentHash = getHash(minified);
          const dir = dirname(oldFileName);
          const base = basename(asset.name ?? oldFileName, `.${extension}`);
          const newFileName = `${dir}/${base}-${contentHash}.${extension}`;

          emitFile({ type: "asset", fileName: newFileName, source: minified });
          delete bundle[oldFileName];

          stringAssets.forEach((strAsset) => {
            const source = strAsset.source as string;
            const candidates = [
              oldFileName,
              oldFileName.replace(" ", "\\ "),
              oldFileName.replace(" ", "%20"),
            ];
            for (const candidate of candidates) {
              if (source.includes(candidate)) {
                strAsset.source = source.replace(candidate, newFileName);
                break;
              }
            }
          });

          logger.minified(fontName, extension, originalBuffer.length, minified.length, isLast);
          stats.minified++;
          stats.saved += originalBuffer.length - minified.length;
        });
      } catch (error) {
        logger.error(`Failed to minify "${fontName}" — keeping original`, {
          error: toError(error) as RollupError,
        });
      }
    }),
  );

  logger.summary(stats);
}
