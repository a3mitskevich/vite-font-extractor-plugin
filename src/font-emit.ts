import { readFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import { normalizePath, type Rollup } from "vite";
import type { OptionsWithCacheSid } from "./types";
import { type PluginContext, getLogger } from "./context";
import { FONT_MIME_TYPES } from "./constants";
import { processMinify } from "./minify";
import { mergeSubsetOptions, parseUrlSubset } from "./subset-options";
import { getFontExtension, getHash, getSubsetKey, toError } from "./utils";

// A font file referenced by a url, `query` keeps everything after the path (`?v=2&subset=A#x`)
export interface FontSource {
  file: string;
  query: string;
}

export interface FaceJob {
  fontName: string;
  options: OptionsWithCacheSid;
  sources: FontSource[];
}

export type EmitContext = Pick<Rollup.PluginContext, "emitFile" | "getFileName">;

// Where the font of a url ends up: an emitted asset or a data: URL (Vite would inline the file)
export type EmittedUrl =
  | { type: "asset"; referenceId: string; postfix: string }
  | { type: "data"; url: string };

const QUERY_START_RE = /[?#]/;
const SUBSET_PARAM = "subset=";
const DEFAULT_ASSETS_INLINE_LIMIT = 4096;

export function splitUrl(url: string): { path: string; query: string } {
  const index = url.search(QUERY_START_RE);
  return index === -1
    ? { path: url, query: "" }
    : { path: url.slice(0, index), query: url.slice(index) };
}

// `?v=2&subset=A#x` → `?v=2#x`: the minified file replaces `?subset=`, other params stay on the url
export function withoutSubsetParam(query: string): string {
  const hashIndex = query.indexOf("#");
  const search = hashIndex === -1 ? query : query.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : query.slice(hashIndex);
  const params = search
    .replace(/^\?/, "")
    .split("&")
    .filter((param) => param && !param.startsWith(SUBSET_PARAM));
  // `?#iefix` (EOT) keeps its bare `?`
  const rest = params.length ? `?${params.join("&")}` : search === "?" ? "?" : "";
  return rest + hash;
}

const toDataUrl = (file: string, content: Buffer): string =>
  `data:${FONT_MIME_TYPES[getFontExtension(file)] ?? "application/octet-stream"};base64,${content.toString("base64")}`;

// Vite's own inlining rule, applied to the original file as Vite would do for it
function shouldInline(ctx: PluginContext, file: string, query: string, original: Buffer): boolean {
  if (/[?&]no-inline\b/.test(query)) return false;
  if (/[?&]inline\b/.test(query)) return true;
  const build = ctx.buildConfig;
  if (!build) return false;
  if (build.lib) return true;
  const limit = build.assetsInlineLimit;
  if (typeof limit === "function") {
    const decision = limit(file, original);
    if (decision != null) return decision;
    return original.length < DEFAULT_ASSETS_INLINE_LIMIT;
  }
  return original.length < Number(limit);
}

const readSource = async (ctx: PluginContext, file: string): Promise<Buffer> => {
  const pending = ctx.sourceReads.get(file) ?? readFile(file);
  ctx.sourceReads.set(file, pending);
  return pending;
};

const GLYPH_LIST_OPTIONS = ["ligatures", "raws", "unicodeRanges"] as const;

// `url(a.woff2?subset=AB), url(a.woff)` without a target: the plain url has nothing to keep
function hasGlyphSelection({ auto, target }: OptionsWithCacheSid): boolean {
  if (auto) return true;
  const fields = target as Partial<Record<(typeof GLYPH_LIST_OPTIONS)[number], unknown[]>>;
  return (
    GLYPH_LIST_OPTIONS.some((option) => !!fields[option]?.length) ||
    ("characters" in target && !!target.characters)
  );
}

// Sources of one glyph set are minified together: formats of one @font-face share one source
function groupBySubset(job: FaceJob): Map<string, FontSource[]> {
  const groups = new Map<string, FontSource[]>();
  for (const source of job.sources) {
    const key = getSubsetKey(parseUrlSubset(source.query));
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  return groups;
}

async function minifyGroup(
  ctx: PluginContext,
  fontName: string,
  options: OptionsWithCacheSid,
  sources: FontSource[],
): Promise<Map<string, Buffer>> {
  const files = [...new Set(sources.map((source) => source.file))];
  const fonts = await Promise.all(
    files.map(async (file) => ({
      url: file,
      extension: getFontExtension(file),
      source: await readSource(ctx, file),
    })),
  );
  if (!ctx.isMinifyPhaseLogged) {
    ctx.isMinifyPhaseLogged = true;
    getLogger(ctx).fix();
    getLogger(ctx).phase("✂ ", "Minify");
  }
  const result = await processMinify(ctx, fontName, fonts, options);
  const minified = new Map<string, Buffer>();
  for (const font of fonts) {
    const buffer = result?.[font.extension];
    if (buffer?.length && buffer.length < font.source.length) {
      minified.set(font.url, buffer);
    }
  }
  ctx.reportMinified(fontName, fonts, minified);
  return minified;
}

/**
 * Minified bytes of every source of the job, keyed by `file + query`. A source without a smaller
 * result (unsupported format, failure) is missing — its url keeps the original file.
 * Identical jobs of one build share one minification.
 */
export async function minifyFace(ctx: PluginContext, job: FaceJob): Promise<Map<string, Buffer>> {
  const results = new Map<string, Buffer>();
  for (const sources of groupBySubset(job).values()) {
    const subset = parseUrlSubset(sources[0].query);
    const options = mergeSubsetOptions(job.options, subset, job.fontName);
    if (!hasGlyphSelection(options)) continue;
    if (options.auto) ctx.autoGlyphSets.add(options.sid);
    const key = `${[...new Set(sources.map((source) => source.file))].join("|")}::${options.sid}`;
    let pending = ctx.minifications.get(key);
    if (!pending) {
      pending = minifyGroup(ctx, job.fontName, options, sources).catch((error: unknown) => {
        const reason = toError(error);
        // Vite's logger does not print `options.error`, so the reason goes into the message
        getLogger(ctx).error(
          `Failed to minify "${job.fontName}" — keeping original: ${reason.message}`,
          {
            error: reason as Rollup.RollupError,
          },
        );
        return new Map<string, Buffer>();
      });
      ctx.minifications.set(key, pending);
    }
    const minified = await pending;
    for (const source of sources) {
      const buffer = minified.get(source.file);
      if (buffer) results.set(source.file + source.query, buffer);
    }
  }
  return results;
}

/**
 * Emits a font like Vite emits an asset: named after the source file, listed in the manifest under
 * the source path. Inlined as a data: URL where Vite would inline the original file.
 */
export async function emitFont(
  emitter: EmitContext,
  ctx: PluginContext,
  source: FontSource,
  content: Buffer,
): Promise<EmittedUrl> {
  const postfix = withoutSubsetParam(source.query);
  if (shouldInline(ctx, source.file, source.query, await readSource(ctx, source.file))) {
    const url = toDataUrl(source.file, content);
    ctx.inlinedFonts.add(getHash(url));
    return { type: "data", url };
  }
  const referenceId = emitter.emitFile({
    type: "asset",
    name: basename(source.file),
    originalFileName: normalizePath(relative(ctx.root, source.file)),
    source: content,
  });
  ctx.emittedFonts.set(referenceId, {
    file: normalizePath(source.file),
    fileName: emitter.getFileName(referenceId),
    isPlain: !parseUrlSubset(source.query),
  });
  return { type: "asset", referenceId, postfix };
}

// Text for a CSS `url()`; the placeholder is resolved by Vite (base, renderBuiltUrl)
export const toCssUrl = (emitted: EmittedUrl): string =>
  emitted.type === "data"
    ? emitted.url
    : `__VITE_ASSET__${emitted.referenceId}__${emitted.postfix}`;

// JS expression of the url, as Vite writes it for an asset import
export const toJsExpression = (emitted: EmittedUrl): string => {
  if (emitted.type === "data") return JSON.stringify(emitted.url);
  const base = `import.meta.ROLLDOWN_FILE_URL_${emitted.referenceId}`;
  return emitted.postfix ? `${base} + ${JSON.stringify(emitted.postfix)}` : base;
};

export const readFontSource = readSource;
