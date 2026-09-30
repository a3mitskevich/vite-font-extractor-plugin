import { basename, relative } from "node:path";
import { normalizePath, type Rollup } from "vite";
import type { PluginContext } from "./context";

type GetFileName = (referenceId: string) => string;

interface ChunkMetadata {
  viteMetadata?: { importedAssets?: Set<string> };
}

const SOURCE_MAP_RE = /\.map$/;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// encodeURI throws on a lone surrogate: such a name has no encoded variant
const tryEncodeURI = (name: string): string[] => {
  try {
    return [encodeURI(name)];
  } catch {
    return [];
  }
};

// A file name is a whole url segment: `icon.woff2` never matches inside `my-icon.woff2`
const createNamePattern = (fileName: string): RegExp => {
  const name = basename(fileName);
  const variants = [...new Set([name, ...tryEncodeURI(name), name.replaceAll(" ", "\\ ")])];
  return new RegExp(`(?<![\\w.-])(?:${variants.map(escapeRegExp).join("|")})(?![\\w-])`);
};

const textOf = (item: Rollup.OutputAsset | Rollup.OutputChunk): string | null => {
  if (SOURCE_MAP_RE.test(item.fileName)) return null;
  if (item.type === "chunk") return item.code;
  return typeof item.source === "string" ? item.source : null;
};

// Chunk metadata first; the texts are read only for files no chunk lists
function createReferenceCheck(bundle: Rollup.OutputBundle): (fileName: string) => boolean {
  const items = Object.values(bundle);
  const imported = new Set(
    items.flatMap((item) => [...((item as ChunkMetadata).viteMetadata?.importedAssets ?? [])]),
  );
  let texts: string[] | undefined;
  return (fileName) => {
    if (imported.has(fileName)) return true;
    texts ??= items.map(textOf).filter((text): text is string => text !== null);
    const pattern = createNamePattern(fileName);
    return texts.some((text) => pattern.test(text));
  };
}

/**
 * Removes fonts Vite emitted for a source the plugin minified once nothing loads them anymore:
 * the CSS of an imported @font-face was pointed at the minified file after Vite had emitted the
 * original, a preload followed the CSS, or a probe named a candidate source. A minified font goes
 * the same way when the preprocessor dropped its @font-face (a mixin that is never included).
 * Runs before Vite writes the manifest, so the manifest never lists a removed file.
 */
export function removeUnusedOriginals(
  ctx: PluginContext,
  bundle: Rollup.OutputBundle,
  getFileName: GetFileName,
): string[] {
  if (!ctx.emittedFonts.size && !ctx.probeAssets.size) return [];
  const minified = new Set([...ctx.emittedFonts.values()].map((font) => font.fileName));
  const sources = new Set(
    [...ctx.emittedFonts.values()].map((font) => normalizePath(relative(ctx.root, font.file))),
  );
  const probes = new Set([...ctx.probeAssets].map(getFileName));
  const isReferenced = createReferenceCheck(bundle);
  const removed: string[] = [];
  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type !== "asset") continue;
    const isOwned =
      minified.has(fileName) ||
      probes.has(fileName) ||
      item.originalFileNames.some((file) => sources.has(file));
    if (isOwned && !isReferenced(fileName)) {
      delete bundle[fileName];
      removed.push(fileName);
    }
  }
  return removed;
}
