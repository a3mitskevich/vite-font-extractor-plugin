import type { OptionsWithCacheSid, SubsetOptions, Target } from "./types";
import { parseSubsetQuery } from "./utils";

const SUBSET_PARAM_RE = /[?&]subset=([^&#]+)/;

// `?subset=` of a font url, undefined when the url has none
export function parseUrlSubset(url: string): SubsetOptions | undefined {
  const value = SUBSET_PARAM_RE.exec(url)?.[1];
  return value ? parseSubsetQuery(value) : undefined;
}

// Characters and ranges of `?subset=` extend the target options and switch it to the subset engine.
// In auto mode the explicit `?subset=` replaces the detected glyphs of that face
export function mergeSubsetOptions(
  options: OptionsWithCacheSid,
  subset: SubsetOptions | undefined,
  fontName: string,
): OptionsWithCacheSid {
  if (!subset) return options;
  // The auto target is a live view whose `fontName` getter throws — it must never be spread
  const base: Target = options.auto ? { fontName } : options.target;
  const baseCharacters = "characters" in base ? base.characters : undefined;
  const unicodeRanges = [...(base.unicodeRanges ?? []), ...(subset.unicodeRanges ?? [])];
  const target = {
    ...base,
    characters: [baseCharacters, subset.characters].filter(Boolean).join("") || undefined,
    unicodeRanges: unicodeRanges.length ? unicodeRanges : undefined,
    engine: "subset" as const,
  };
  return { target, sid: JSON.stringify(target), auto: false };
}
