import type { FaceMatcher, FontFaceInfo, OptionsWithCacheSid, Target } from "./types";
import { PLUGIN_NAME } from "./constants";

export type FacePredicate = (face: FontFaceInfo) => boolean;

// A configured target with the faces it applies to
export interface TargetMatcher {
  target: Target;
  options: OptionsWithCacheSid;
  matches: FacePredicate;
}

// Options removed from targets, with what replaces them
const REMOVED_TARGET_OPTIONS: Record<string, string> = {
  withWhitespace:
    'fontext 2 no longer adds a space glyph — add " " to `characters` (subset engine)',
};

// A target set in the config or returned by `resolveTarget`
export function assertTarget(target: Target, source = "Target"): void {
  if (!target || typeof target !== "object" || typeof target.fontName !== "string") {
    throw new Error(`[${PLUGIN_NAME}] ${source}: a target needs a \`fontName\` string`);
  }
  for (const [option, replacement] of Object.entries(REMOVED_TARGET_OPTIONS)) {
    if (option in target) {
      throw new Error(
        `[${PLUGIN_NAME}] Target "${target.fontName}": \`${option}\` was removed in 4.0: ${replacement}`,
      );
    }
  }
}

export function toFacePredicate(matcher: FaceMatcher): FacePredicate {
  if (typeof matcher === "function") return matcher;
  if (typeof matcher === "string") return (face) => face.family === matcher;
  if (matcher instanceof RegExp) {
    // `g` and `y` make `test` depend on the previous call: every face must get the same answer
    const pattern = new RegExp(matcher.source, matcher.flags.replace(/[gy]/g, ""));
    return (face) => pattern.test(face.family);
  }
  throw new Error(
    `[${PLUGIN_NAME}] A face matcher must be a string, a RegExp or a function, got ${typeof matcher}`,
  );
}

// `match` decides which faces a target minifies, not how: it stays out of the sid (cache key and
// output names) and of the options passed on
export function toTargetOptions(target: Target): OptionsWithCacheSid {
  const options = Object.fromEntries(
    Object.entries(target).filter(([key]) => key !== "match"),
  ) as Target;
  return { sid: JSON.stringify(options), target: options, auto: false };
}

// Labels name targets in logs and the cache: two targets with one label could not be told apart
function assertUniqueLabels(targets: Target[]): void {
  const seen = new Set<string>();
  for (const { fontName } of targets) {
    if (seen.has(fontName)) {
      throw new Error(
        `[${PLUGIN_NAME}] Two targets are named "${fontName}": give each target its own fontName and select its faces with \`match\``,
      );
    }
    seen.add(fontName);
  }
}

export function compileTargets(targets: Target[]): TargetMatcher[] {
  targets.forEach((target) => assertTarget(target));
  assertUniqueLabels(targets);
  return targets.map((target) => ({
    target,
    options: toTargetOptions(target),
    matches: toFacePredicate(target.match ?? target.fontName),
  }));
}
