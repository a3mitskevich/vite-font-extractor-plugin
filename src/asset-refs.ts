import type { SubsetOptions } from "./types";
import { getSubsetKey, parseSubsetQuery } from "./utils";
import { SUBSET_PARAM_RE } from "./subset-options";

export interface AssetReference {
  referenceId: string;
  subset?: SubsetOptions;
}

// Placeholders Vite leaves in transformed code for emitted assets:
//   __VITE_ASSET__<ref>__?subset=ABC                     CSS
//   import.meta.ROLLDOWN_FILE_URL_<ref> + "?subset=ABC"  JS asset import
// Vite decodes the url, so the query may contain spaces (`?subset=A%20B` → `?subset=A B`),
// but not line breaks: placeholders may come one per line
const ASSET_PLACEHOLDER_RE =
  /__VITE_ASSET__([\w$-]+)__(\?[^"'`)\r\n]*)?|import\.meta\.ROLLDOWN_FILE_URL_([\w$-]+)(?:\s*\+\s*(["'`])(\?[^"'`]*)\4)?/g;

const parseSubset = (query: string | undefined): SubsetOptions | undefined => {
  const value = query ? SUBSET_PARAM_RE.exec(query)?.[1] : undefined;
  return value ? parseSubsetQuery(value) : undefined;
};

export function extractAssetReferences(code: string): AssetReference[] {
  return Array.from(code.matchAll(ASSET_PLACEHOLDER_RE), (match) => ({
    referenceId: match[1] ?? match[3],
    subset: parseSubset(match[2] ?? match[5]),
  }));
}

export const getReferenceKey = ({ referenceId, subset }: AssetReference): string =>
  `${referenceId}:${getSubsetKey(subset)}`;

// Group of a `?subset=` reference found outside of @font-face (e.g. a JS import)
export const STANDALONE_GROUP_PREFIX = "ref:";

export const getStandaloneGroupId = (referenceId: string): string =>
  STANDALONE_GROUP_PREFIX + referenceId;

// Every format of one @font-face shares the group, so all of them are minified from one source
export const getFaceGroupId = (references: AssetReference[]): string =>
  "face:" + [...new Set(references.map((reference) => reference.referenceId))].sort().join(",");
