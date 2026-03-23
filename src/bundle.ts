import type { OutputAsset, RollupError } from "rollup";
import { basename } from "node:path";
import type { MinifyFontOptions } from "./types";
import { camelCase, getFontExtension, groupBy } from "./utils";
import { PROCESS_EXTENSION } from "./constants";
import styler from "./styler";
import type { PluginContext } from "./context";
import { processMinify } from "./minify";

export async function generateBundleHook(
  getFileName: (referenceId: string) => string,
  ctx: PluginContext,
  bundle: Record<string, OutputAsset>,
): Promise<void> {
  if (!ctx.transformMap.size) {
    return;
  }
  ctx.logger.fix();
  try {
    const findAssetByReferenceId = (referenceId: string): OutputAsset =>
      Object.values(bundle).find((asset) =>
        asset.fileName.includes(getFileName(referenceId)),
      ) as OutputAsset;

    const resources = Array.from(ctx.transformMap.entries()).map<[OutputAsset, OutputAsset]>(
      ([oldReferenceId, newReferenceId]) => {
        return [findAssetByReferenceId(oldReferenceId), findAssetByReferenceId(newReferenceId)];
      },
    );

    const unminifiedFonts = groupBy(
      resources.filter(([_, newFont]) => newFont.fileName.endsWith(PROCESS_EXTENSION)),
      ([_, newFont]) => basename(newFont.name ?? newFont.fileName).replace(PROCESS_EXTENSION, ""),
    );

    const stringAssets = Object.values(bundle).filter(
      (asset): asset is OutputAsset => asset.type === "asset" && typeof asset.source === "string",
    );

    const fontReplacements = new Map<
      string,
      { newFileName: string; newName: string; newSource: Buffer | Uint8Array }
    >();

    await Promise.all(
      Object.entries(unminifiedFonts).map(async ([fontName, transforms]) => {
        const minifiedBuffer = await processMinify(
          ctx,
          fontName,
          transforms.map<MinifyFontOptions>(([originalFont, _newFont]) => ({
            extension: getFontExtension(originalFont.fileName),
            source: Buffer.from(originalFont.source),
            url: "",
          })),
          ctx.optionsMap.get(fontName)!,
        );

        transforms.forEach(([originalFont, newFont]) => {
          const extension = getFontExtension(originalFont.fileName);
          const fixedName = originalFont.name
            ? basename(originalFont.name, `.${extension}`)
            : camelCase(fontName);
          const temporalNewFontFilename = newFont.fileName;
          const fixedBasename = (
            basename(newFont.fileName, PROCESS_EXTENSION) + `.${extension}`
          ).replace(fontName, fixedName);
          const correctName = fixedName + `.${extension}`;
          const newFileName = newFont.fileName.replace(
            basename(temporalNewFontFilename),
            fixedBasename,
          );

          const potentialTemporalNewFontBaseNames = [
            temporalNewFontFilename.replace(" ", "\\ "),
            temporalNewFontFilename.replace(" ", "%20"),
          ];

          stringAssets.forEach((asset) => {
            const temporalNewFontBasename = potentialTemporalNewFontBaseNames.find((candidate) =>
              (asset.source as string).includes(candidate),
            );
            if (temporalNewFontBasename) {
              ctx.logger.info(
                `Change name from "${styler.green(temporalNewFontBasename)}" to "${styler.green(newFileName)}" in ${styler.path(asset.fileName)}`,
              );
              asset.source = (asset.source as string).replace(temporalNewFontBasename, newFileName);
            }
          });

          const newSource = minifiedBuffer?.[extension] ?? Buffer.alloc(0);

          delete bundle[temporalNewFontFilename];
          bundle[newFileName] = {
            type: "asset" as const,
            fileName: newFileName,
            name: correctName,
            source: newSource,
            needsCodeReference: false,
          } as unknown as OutputAsset;

          fontReplacements.set(temporalNewFontFilename, {
            newFileName,
            newName: correctName,
            newSource,
          });
        });
      }),
    );

    resources.forEach(([originalFont, newFont]) => {
      const originalBuffer = Buffer.from(originalFont.source);
      const replacement = fontReplacements.get(newFont.fileName);
      const currentAsset = replacement
        ? (bundle[replacement.newFileName] as OutputAsset | undefined)
        : newFont;

      if (!currentAsset) {
        ctx.logger.info(`Delete old asset from: ${styler.path(originalFont.fileName)}`);
        delete bundle[originalFont.fileName];
        return;
      }

      const newSource = Buffer.from(currentAsset.source);
      const newLength = newSource.length;
      const originalLength = originalBuffer.length;
      const resultLessThanOriginal = newLength > 0 && newLength < originalLength;

      if (!resultLessThanOriginal) {
        const comparePreview = styler.red(`[${newLength} < ${originalLength}]`);
        ctx.logger.warn(
          `New font no less than original ${comparePreview}. Revert content to original font`,
        );
        const fileName = currentAsset.fileName;
        delete bundle[fileName];
        bundle[fileName] = {
          type: "asset" as const,
          fileName,
          name: currentAsset.name,
          source: originalBuffer,
          needsCodeReference: false,
        } as unknown as OutputAsset;
      }
      ctx.logger.info(`Delete old asset from: ${styler.path(originalFont.fileName)}`);
      delete bundle[originalFont.fileName];
    });
  } catch (error) {
    ctx.logger.error("Clean up generated bundle has failed", { error: error as RollupError });
    throw error;
  }
}
