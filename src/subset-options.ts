import type { OptionsWithCacheSid, SubsetOptions } from "./types";
import { parseSubsetQuery } from "./utils";

const SUBSET_PARAM_RE = /[?&]subset=([^&#]+)/;

// `?subset=` of a font url, undefined when the url has none
export function parseUrlSubset(url: string): SubsetOptions | undefined {
  const value = SUBSET_PARAM_RE.exec(url)?.[1];
  return value ? parseSubsetQuery(value) : undefined;
}

// Characters and ranges of `?subset=` extend the target options and switch it to the subset engine
export function mergeSubsetOptions(
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
