import type { OptionsWithCacheSid, SubsetOptions } from "./types";
import type { PluginContext } from "./context";

// Matches resolved font URLs with ?subset= in JS chunks
// e.g. "/assets/font-abc123.woff2?subset=ABC"
const FONT_SUBSET_URL_RE = /(["'])([^"']*\.(?:woff2?|ttf|eot|otf))\?subset=([^"'&]+)\1/g;

function parseSubsetValue(value: string): SubsetOptions {
  const parts = value.split(",");
  const characters: string[] = [];
  const unicodeRanges: string[] = [];
  for (const part of parts) {
    if (part.startsWith("U+") || part.startsWith("u+")) {
      unicodeRanges.push(part);
    } else {
      characters.push(part);
    }
  }
  return {
    characters: characters.length > 0 ? characters.join("") : undefined,
    unicodeRanges: unicodeRanges.length > 0 ? unicodeRanges : undefined,
  };
}

export function renderChunkHook(ctx: PluginContext, code: string): string | null {
  if (!code.includes("?subset=")) return null;

  let modified = false;
  const result = code.replace(
    FONT_SUBSET_URL_RE,
    (fullMatch, quote: string, assetPath: string, subsetValue: string) => {
      const subset = parseSubsetValue(subsetValue);

      // Use assetPath as key (will match bundle fileName in generateBundle)
      // Strip leading / for bundle key matching
      const assetKey = assetPath.startsWith("/") ? assetPath.slice(1) : assetPath;

      if (!ctx.transformMap.has(assetKey)) {
        const fontName = `__subset_js_${assetKey.replace(/\//g, "-")}`;
        const options: OptionsWithCacheSid = {
          sid: JSON.stringify(subset),
          target: {
            fontName,
            characters: subset.characters,
            unicodeRanges: subset.unicodeRanges,
            engine: "subset" as const,
          },
          auto: false,
        };
        ctx.transformMap.set(assetKey, { fontName, options, subset });
      }

      // Strip ?subset= from URL so browser gets clean path
      modified = true;
      return `${quote}${assetPath}${quote}`;
    },
  );

  return modified ? result : null;
}
