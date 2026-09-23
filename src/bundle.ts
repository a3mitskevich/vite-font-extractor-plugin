import type { Rollup } from "vite";
import { basename, dirname } from "node:path";
import type {
  FontReference,
  InternalLogger,
  MinifyFontOptions,
  MinifyStats,
  OptionsWithCacheSid,
  SubsetOptions,
} from "./types";
import { getFontExtension, getHash, getSubsetKey, toError } from "./utils";
import { type PluginContext, getLogger } from "./context";
import { processMinify } from "./minify";
import { type AssetRename, rewriteFontReferences } from "./rewrite-refs";

type GetFileName = (referenceId: string) => string;
type EmitFile = (file: Rollup.EmittedAsset) => string;

interface FontGroup {
  fontName: string;
  options: OptionsWithCacheSid;
  subsetKey: string;
  assets: Rollup.OutputAsset[];
}

interface MinifiedAsset extends AssetRename {
  savedBytes: number;
}

function mergeSubsetOptions(
  options: OptionsWithCacheSid,
  subset: SubsetOptions | undefined,
): OptionsWithCacheSid {
  if (!subset) return options;
  const targetCharacters = "characters" in options.target ? options.target.characters : undefined;
  const unicodeRanges = [...(options.target.unicodeRanges ?? []), ...(subset.unicodeRanges ?? [])];
  const target = {
    ...options.target,
    characters: [targetCharacters, subset.characters].filter(Boolean).join("") || undefined,
    unicodeRanges: unicodeRanges.length ? unicodeRanges : undefined,
    engine: "subset" as const,
  };
  return { ...options, target, sid: JSON.stringify(target) };
}

function resolveAsset(
  getFileName: GetFileName,
  bundle: Rollup.OutputBundle,
  reference: FontReference,
): Rollup.OutputAsset | undefined {
  try {
    const item = bundle[getFileName(reference.referenceId)];
    return item?.type === "asset" ? item : undefined;
  } catch {
    return undefined;
  }
}

// One group = formats of one font source with one glyph set, minified by a single extract() call
function collectFontGroups(
  getFileName: GetFileName,
  ctx: PluginContext,
  bundle: Rollup.OutputBundle,
  logger: InternalLogger,
): FontGroup[] {
  const groups = new Map<string, FontGroup>();
  const seenAssets = new Set<string>();

  for (const [key, reference] of ctx.transformMap) {
    const asset = resolveAsset(getFileName, bundle, reference);
    if (!asset) {
      logger.warn(`Asset not found for key ${key}`);
      continue;
    }

    const subsetKey = getSubsetKey(reference.subset);
    // The same file can be referenced from several places (CSS + JS, repeated @font-face)
    const assetKey = `${asset.fileName}::${subsetKey}`;
    if (seenAssets.has(assetKey)) continue;
    seenAssets.add(assetKey);

    const groupKey = `${reference.groupId}::${subsetKey}`;
    const group = groups.get(groupKey) ?? {
      fontName: reference.fontName,
      options: mergeSubsetOptions(reference.options, reference.subset),
      subsetKey,
      assets: [],
    };
    group.assets.push(asset);
    groups.set(groupKey, group);
  }

  return [...groups.values()];
}

async function minifyGroup(
  ctx: PluginContext,
  emitFile: EmitFile,
  { fontName, options, subsetKey, assets }: FontGroup,
): Promise<MinifiedAsset[]> {
  const logger = getLogger(ctx);
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
    return assets.flatMap((asset, idx) => {
      const extension = getFontExtension(asset.fileName);
      const originalSize = Buffer.from(asset.source).length;
      const minified = minifiedBuffer?.[extension];

      if (!minified || minified.length === 0 || minified.length >= originalSize) {
        logger.skipped(fontName, `${extension} not smaller than original`);
        return [];
      }

      const oldFileName = asset.fileName;
      const base = basename(asset.name ?? oldFileName, `.${extension}`);
      const newFileName = `${dirname(oldFileName)}/${base}-${getHash(minified)}.${extension}`;
      emitFile({ type: "asset", fileName: newFileName, source: minified });

      const isLast = idx === assets.length - 1;
      logger.minified(fontName, extension, originalSize, minified.length, isLast);
      return [{ oldFileName, newFileName, subsetKey, savedBytes: originalSize - minified.length }];
    });
  } catch (error) {
    logger.error(`Failed to minify "${fontName}" — keeping original`, {
      error: toError(error) as Rollup.RollupError,
    });
    return [];
  }
}

export async function generateBundleHook(
  getFileName: GetFileName,
  emitFile: EmitFile,
  ctx: PluginContext,
  bundle: Rollup.OutputBundle,
): Promise<void> {
  if (!ctx.transformMap.size) {
    return;
  }
  const logger = getLogger(ctx);
  logger.fix();

  const groups = collectFontGroups(getFileName, ctx, bundle, logger);

  logger.phase("✂ ", "Minify");

  const minified = (
    await Promise.all(groups.map((group) => minifyGroup(ctx, emitFile, group)))
  ).flat();

  const stillReferenced = rewriteFontReferences(bundle, minified);
  for (const oldFileName of new Set(minified.map((asset) => asset.oldFileName))) {
    if (!stillReferenced.has(oldFileName)) {
      delete bundle[oldFileName];
    }
  }

  const stats: MinifyStats = {
    minified: minified.length,
    cached: 0,
    saved: minified.reduce((sum, asset) => sum + asset.savedBytes, 0),
  };
  logger.summary(stats);

  await ctx.cache?.prune();
}
