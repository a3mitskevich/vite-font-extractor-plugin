import type { Rollup } from "vite";
import { basename } from "node:path";
import { getSubsetKey, parseSubsetQuery } from "./utils";
import { FONT_FACE_BLOCK_RE, getBlockFamily, normalizeFamily } from "./output-font-face";

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
  // Keyed by normalized font-family
  byFamily: Map<string, string>;
  // Used outside of @font-face blocks (JS, html preload)
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

// A file name is a whole token: `icon.woff` must not match inside `my-icon.woff2`
const NAME_START = "(?<![\\w.%-])";
const NAME_END = "(?![\\w-])";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Matches `<name>`, `<name>?subset=X` and the unminified Rolldown form `<name>" + "?subset=X"`
const createReferencePattern = (names: string[]): RegExp =>
  new RegExp(
    `${NAME_START}(${names.map(escapeRegExp).join("|")})${NAME_END}` +
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

function createTargets(renames: AssetRename[]): RenameTargets {
  const targets: RenameTargets = new Map();
  for (const { oldFileName, newFileName, subsetKey, fontName } of renames) {
    const oldBase = basename(oldFileName);
    const newBase = basename(newFileName);
    const bySubset = targets.get(oldBase) ?? new Map<string, RenameTarget>();
    const target = bySubset.get(subsetKey) ?? { byFamily: new Map(), fallback: newBase };
    target.byFamily.set(normalizeFamily(fontName), newBase);
    bySubset.set(subsetKey, target);
    targets.set(oldBase, bySubset);
  }
  return targets;
}

// Inside @font-face a family without its own result keeps the original (full) file
const pickNewBase = (target: RenameTarget, family: string | undefined): string | undefined =>
  family === undefined ? target.fallback : target.byFamily.get(normalizeFamily(family));

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

type RewriteNames = (text: string, family?: string) => string;

function createNameRewriter(renames: AssetRename[]): RewriteNames {
  const variants = createNameVariants(renames);
  const targets = createTargets(renames);
  const names = [...variants.keys()].sort((a, b) => b.length - a.length);
  const pattern = createReferencePattern(names);

  return (text, family) =>
    text.replace(
      pattern,
      (match, name: string, query?: string, quote?: string, _q?: string, concatQuery?: string) => {
        const { oldBase, encode } = variants.get(name)!;
        const value = query ?? concatQuery;
        const subsetKey = value ? getSubsetKey(parseSubsetQuery(value)) : "";
        const target = targets.get(oldBase)?.get(subsetKey);
        const newBase = target && pickNewBase(target, family);
        if (!newBase) return match;
        return encode(newBase) + (concatQuery ? quote : "");
      },
    );
}

// @font-face blocks are rewritten per family, the text around them with the fallback
const rewriteText = (text: string, rewriteNames: RewriteNames): string => {
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(FONT_FACE_BLOCK_RE)) {
    const [block] = match;
    result += rewriteNames(text.slice(lastIndex, match.index));
    result += rewriteNames(block, getBlockFamily(block));
    lastIndex = match.index + block.length;
  }
  return result + rewriteNames(text.slice(lastIndex));
};

function findLeftovers(texts: string[], renames: AssetRename[]): Set<string> {
  const leftovers = new Set<string>();
  for (const oldFileName of new Set(renames.map((rename) => rename.oldFileName))) {
    const oldBase = basename(oldFileName);
    const pattern = new RegExp(
      NAME_ENCODERS.map((encode) => NAME_START + escapeRegExp(encode(oldBase)) + NAME_END).join(
        "|",
      ),
    );
    if (texts.some((text) => pattern.test(text))) leftovers.add(oldFileName);
  }
  return leftovers;
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

  const rewriteNames = createNameRewriter(renames);
  const texts: string[] = [];
  for (const item of Object.values(bundle)) {
    if (item.type === "chunk") {
      const code = rewriteText(item.code, rewriteNames);
      if (code !== item.code) {
        item.code = code;
        updateImportedAssets(item, renames);
      }
      texts.push(item.code);
    } else if (typeof item.source === "string") {
      item.source = rewriteText(item.source, rewriteNames);
      texts.push(item.source);
    }
  }

  return findLeftovers(texts, renames);
}
