import type { Rollup } from "vite";
import { type AssetRename, createFileNamePattern } from "./rewrite-refs";

// Keys and `src` are source paths, only `file` and `assets` name emitted files
interface ManifestEntry {
  file: string;
  assets?: string[];
}

type Manifest = Record<string, ManifestEntry>;

interface RenameIndex {
  // Every minified file made from an original
  byOld: Map<string, string[]>;
  // The file that replaces an original referenced without `?subset=`
  fallbackByOld: Map<string, string>;
  // Rolldown does not add files emitted in generateBundle to the bundle object of the hook
  isEmitted: (fileName: string) => boolean;
}

// `build.manifest`: `true` writes `.vite/manifest.json` (Vite 5+), a string is the file name
export const getManifestFileName = (manifest: boolean | string | undefined): string | null =>
  manifest === true ? ".vite/manifest.json" : manifest || null;

function createRenameIndex(bundle: Rollup.OutputBundle, renames: AssetRename[]): RenameIndex {
  const byOld = new Map<string, string[]>();
  const fallbackByOld = new Map<string, string>();
  for (const { oldFileName, newFileName, subsetKey } of renames) {
    const files = byOld.get(oldFileName) ?? [];
    byOld.set(oldFileName, files.includes(newFileName) ? files : [...files, newFileName]);
    if (!subsetKey && !fallbackByOld.has(oldFileName)) {
      fallbackByOld.set(oldFileName, newFileName);
    }
  }
  const minified = new Set(renames.map((rename) => rename.newFileName));
  return {
    byOld,
    fallbackByOld,
    isEmitted: (fileName) => fileName in bundle || minified.has(fileName),
  };
}

const textOf = (item: Rollup.OutputAsset | Rollup.OutputChunk | undefined): string | null => {
  if (!item) return null;
  if (item.type === "chunk") return item.code;
  return typeof item.source === "string" ? item.source : null;
};

// A renamed original is replaced by the files its entry actually loads
function rewriteAssets(
  assets: string[],
  text: string | null,
  { byOld, isEmitted }: RenameIndex,
): string[] {
  const next = assets.flatMap((asset) => {
    const renamed = byOld.get(asset);
    if (!renamed || text === null) return [asset];
    return [asset, ...renamed].filter((file) => createFileNamePattern(file).test(text));
  });
  return [...new Set(next)].filter(isEmitted);
}

// null drops the entry: its original font was removed and nothing replaces it
function rewriteEntry(
  entry: ManifestEntry,
  bundle: Rollup.OutputBundle,
  index: RenameIndex,
): ManifestEntry | null {
  const file = index.isEmitted(entry.file) ? entry.file : index.fallbackByOld.get(entry.file);
  if (!file) return null;
  const { assets: previousAssets, ...rest } = entry;
  if (!previousAssets) return { ...rest, file };
  const assets = rewriteAssets(previousAssets, textOf(bundle[file]), index);
  return assets.length ? { ...rest, file, assets } : { ...rest, file };
}

const readSource = (source: string | Uint8Array): string =>
  typeof source === "string" ? source : Buffer.from(source).toString("utf8");

/**
 * Points the Vite manifest at the minified fonts. Runs after the originals no longer referenced
 * are removed from the bundle: keys and `src` (source paths) stay, `file` and `assets` follow
 * the emitted files.
 */
export function rewriteManifest(
  bundle: Rollup.OutputBundle,
  fileName: string | null,
  renames: AssetRename[],
  warn: (message: string) => void,
): void {
  const item = fileName ? bundle[fileName] : undefined;
  if (!renames.length || item?.type !== "asset") return;
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readSource(item.source)) as Manifest;
  } catch (error) {
    warn(`Can not read ${fileName} — minified fonts are not listed in it: ${String(error)}`);
    return;
  }
  const index = createRenameIndex(bundle, renames);
  const entries = Object.entries(manifest).flatMap(([key, entry]) => {
    const next = rewriteEntry(entry, bundle, index);
    return next ? [[key, next] as const] : [];
  });
  item.source = JSON.stringify(Object.fromEntries(entries), null, 2);
}
