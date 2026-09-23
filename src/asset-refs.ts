import type { SubsetOptions } from "./types";
import { getSubsetKey, parseSubsetQuery } from "./utils";

export interface AssetReference {
  referenceId: string;
  subset?: SubsetOptions;
}

// Placeholders Vite leaves in transformed code for emitted assets:
//   __VITE_ASSET__<ref>__$_?subset=ABC__                 Vite 5–7 (CSS and JS)
//   __VITE_ASSET__<ref>__?subset=ABC                     Vite 8 (CSS)
//   import.meta.ROLLDOWN_FILE_URL_<ref> + "?subset=ABC"  Vite 8 (JS asset import)
const ASSET_PLACEHOLDER_RE =
  /__VITE_ASSET__([\w$-]+)__(?:\$_([^"'`)\s]*?)__|(\?[^"'`)\s]*))?|import\.meta\.ROLLDOWN_FILE_URL_([\w$-]+)(?:\s*\+\s*(["'`])(\?[^"'`]*)\5)?/g;

const SUBSET_PARAM_RE = /[?&]subset=([^&#]+)/;

const parseSubset = (query: string | undefined): SubsetOptions | undefined => {
  const value = query ? SUBSET_PARAM_RE.exec(query)?.[1] : undefined;
  return value ? parseSubsetQuery(value) : undefined;
};

export function extractAssetReferences(code: string): AssetReference[] {
  return Array.from(code.matchAll(ASSET_PLACEHOLDER_RE), (match) => ({
    referenceId: match[1] ?? match[4],
    subset: parseSubset(match[2] ?? match[3] ?? match[6]),
  }));
}

export const getReferenceKey = ({ referenceId, subset }: AssetReference): string =>
  `${referenceId}:${getSubsetKey(subset)}`;

// Every format of one @font-face shares the group, so all of them are minified from one source
export const getFaceGroupId = (references: AssetReference[]): string =>
  "face:" + [...new Set(references.map((reference) => reference.referenceId))].sort().join(",");
