import type { Rollup } from "vite";
import { basename } from "node:path";
import { getSubsetKey, parseSubsetQuery } from "./utils";

export interface AssetRename {
  oldFileName: string;
  newFileName: string;
  // "" when the minified font replaces references without `?subset=`
  subsetKey: string;
}

interface NameVariant {
  oldBase: string;
  encode: (name: string) => string;
}

interface ChunkMetadata {
  viteMetadata?: { importedAssets?: Set<string> };
}

// File names can appear escaped in CSS/JS output
const NAME_ENCODERS: Array<(name: string) => string> = [
  (name) => name,
  (name) => name.replaceAll(" ", "\\ "),
  (name) => name.replaceAll(" ", "%20"),
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Matches `<name>`, `<name>?subset=X` and the unminified Rolldown form `<name>" + "?subset=X"`
const createReferencePattern = (names: string[]): RegExp =>
  new RegExp(
    `(${names.map(escapeRegExp).join("|")})` +
      "(?:\\?subset=([^\"'`)\\s&]+)|([\"'`])\\s*\\+\\s*([\"'`])\\?subset=([^\"'`&\\s]+)\\4)?",
    "g",
  );

function createNameVariants(renames: AssetRename[]): Map<string, NameVariant> {
  const variants = new Map<string, NameVariant>();
  for (const { oldFileName } of renames) {
    const oldBase = basename(oldFileName);
    for (const encode of NAME_ENCODERS) {
      variants.set(encode(oldBase), { oldBase, encode });
    }
  }
  return variants;
}

function createTargets(renames: AssetRename[]): Map<string, Map<string, string>> {
  const targets = new Map<string, Map<string, string>>();
  for (const { oldFileName, newFileName, subsetKey } of renames) {
    const oldBase = basename(oldFileName);
    const bySubset = targets.get(oldBase) ?? new Map<string, string>();
    bySubset.set(subsetKey, basename(newFileName));
    targets.set(oldBase, bySubset);
  }
  return targets;
}

function updateImportedAssets(chunk: Rollup.OutputChunk, renames: AssetRename[]): void {
  const importedAssets = (chunk as ChunkMetadata).viteMetadata?.importedAssets;
  if (!importedAssets) return;
  for (const { oldFileName, newFileName } of renames) {
    if (!importedAssets.has(oldFileName)) continue;
    if (chunk.code.includes(basename(newFileName))) {
      importedAssets.add(newFileName);
    }
    if (!chunk.code.includes(basename(oldFileName))) {
      importedAssets.delete(oldFileName);
    }
  }
}

/**
 * Points every CSS/HTML/JS reference of a renamed font to its minified file.
 * Returns old file names that are still referenced and therefore must stay in the bundle.
 */
export function rewriteFontReferences(
  bundle: Rollup.OutputBundle,
  renames: AssetRename[],
): Set<string> {
  if (!renames.length) return new Set();

  const variants = createNameVariants(renames);
  const targets = createTargets(renames);
  const names = [...variants.keys()].sort((a, b) => b.length - a.length);
  const pattern = createReferencePattern(names);

  const rewrite = (text: string): string =>
    text.replace(
      pattern,
      (
        match,
        name: string,
        query?: string,
        quote?: string,
        _quote?: string,
        concatQuery?: string,
      ) => {
        const { oldBase, encode } = variants.get(name)!;
        const value = query ?? concatQuery;
        const subsetKey = value ? getSubsetKey(parseSubsetQuery(value)) : "";
        const target = targets.get(oldBase)?.get(subsetKey);
        if (!target) return match;
        return encode(target) + (concatQuery ? quote : "");
      },
    );

  const texts: string[] = [];
  for (const item of Object.values(bundle)) {
    if (item.type === "chunk") {
      const code = rewrite(item.code);
      if (code !== item.code) {
        item.code = code;
        updateImportedAssets(item, renames);
      }
      texts.push(item.code);
    } else if (typeof item.source === "string") {
      item.source = rewrite(item.source);
      texts.push(item.source);
    }
  }

  const leftovers = new Set<string>();
  for (const { oldFileName } of renames) {
    const oldBase = basename(oldFileName);
    const isReferenced = NAME_ENCODERS.some((encode) =>
      texts.some((text) => text.includes(encode(oldBase))),
    );
    if (isReferenced) leftovers.add(oldFileName);
  }
  return leftovers;
}
