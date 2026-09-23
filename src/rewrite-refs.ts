import type { Rollup } from "vite";
import { basename } from "node:path";
import { getSubsetKey, parseSubsetQuery } from "./utils";

export interface AssetRename {
  oldFileName: string;
  newFileName: string;
  // "" when the minified font replaces references without `?subset=`
  subsetKey: string;
  // CSS font-family the result was minified for
  fontName: string;
}

interface NameVariant {
  oldBase: string;
  encode: (name: string) => string;
}

interface RenameTarget {
  byFamily: Map<string, string>;
  // Used outside of @font-face blocks (JS, html preload) and for unknown families
  fallback: string;
}

// oldBase → subsetKey → target
type RenameTargets = Map<string, Map<string, RenameTarget>>;

interface ChunkMetadata {
  viteMetadata?: { importedAssets?: Set<string> };
}

// File names can appear escaped in CSS/JS output
const NAME_ENCODERS: Array<(name: string) => string> = [
  (name) => name,
  (name) => name.replaceAll(" ", "\\ "),
  (name) => name.replaceAll(" ", "%20"),
];

const FONT_FACE_BLOCK_RE = /@font-face\s*\{[^}]*\}/g;
const FONT_FAMILY_DECLARATION_RE = /font-family\s*:\s*([^;}]+)/;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Matches `<name>`, `<name>?subset=X` and the unminified Rolldown form `<name>" + "?subset=X"`
const createReferencePattern = (names: string[]): RegExp =>
  new RegExp(
    `(${names.map(escapeRegExp).join("|")})` +
      "(?:\\?subset=([^\"'`)\\s&]+)|([\"'`])\\s*\\+\\s*([\"'`])\\?subset=([^\"'`&\\s]+)\\4)?",
    "g",
  );

const getBlockFamily = (block: string): string | undefined =>
  FONT_FAMILY_DECLARATION_RE.exec(block)?.[1].replace(/["']/g, "").trim();

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

function createTargets(renames: AssetRename[]): RenameTargets {
  const targets: RenameTargets = new Map();
  for (const { oldFileName, newFileName, subsetKey, fontName } of renames) {
    const oldBase = basename(oldFileName);
    const newBase = basename(newFileName);
    const bySubset = targets.get(oldBase) ?? new Map<string, RenameTarget>();
    const target = bySubset.get(subsetKey) ?? { byFamily: new Map(), fallback: newBase };
    target.byFamily.set(fontName, newBase);
    bySubset.set(subsetKey, target);
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
 * Inside @font-face the file minified for that font-family is used.
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

  const rewriteNames = (text: string, family?: string): string =>
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
        const newBase = (family && target.byFamily.get(family)) || target.fallback;
        return encode(newBase) + (concatQuery ? quote : "");
      },
    );

  const rewrite = (text: string): string =>
    rewriteNames(
      text.replace(FONT_FACE_BLOCK_RE, (block) => rewriteNames(block, getBlockFamily(block))),
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
