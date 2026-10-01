import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { normalizePath, type Rollup } from "vite";
import type { OptionsWithCacheSid } from "./types";
import type { PluginContext } from "./context";

// src/ and dist/ both sit next to package.json
const PACKAGE_VERSION = (createRequire(import.meta.url)("../package.json") as { version: string })
  .version;
export const INLINE_OUTPUT = "inline";

export interface ReportGlyphs {
  ligatures?: string[];
  raws?: string[];
  characters?: string;
  unicodeRanges?: string[];
}

export interface ReportFont {
  fontName: string;
  // Source file relative to the root
  source: string;
  format: string;
  // Output file name, or "inline" for a data: URL
  output: string;
  originalSize: number;
  minifiedSize: number;
  cached: boolean;
  glyphs: ReportGlyphs;
}

export interface ReportSkip {
  fontName: string;
  source?: string;
  reason: string;
}

// Why the plugin left a face alone on purpose: not a problem, the answer to "why is it not minified"
export type IgnoreReason = "ignore" | "include/exclude" | "resolveTarget";

export interface ReportIgnored {
  fontName: string;
  // Module id of the stylesheet, relative to the root
  id: string;
  reason: IgnoreReason;
}

export type ReportRecord =
  | ({ kind: "font" } & ReportFont)
  | ({ kind: "skipped" } & ReportSkip)
  | ({ kind: "ignored" } & ReportIgnored);

export interface FontReport {
  version: string;
  mode: string;
  environment: string;
  fonts: ReportFont[];
  skipped: ReportSkip[];
  // Present when a face was ignored
  ignored?: ReportIgnored[];
  totals: { originalSize: number; minifiedSize: number; saved: number };
}

// What a minified buffer was made from, until the buffer is emitted
type MinifiedInfo = Omit<ReportFont, "output">;
const minifiedInfo = new WeakMap<Buffer, MinifiedInfo>();

export const toReportSource = (ctx: PluginContext, file: string): string =>
  normalizePath(relative(ctx.root, file));

// The glyphs a font was minified with; auto mode lists every glyph found in CSS `content`
export function glyphsOf({ target }: OptionsWithCacheSid): ReportGlyphs {
  const fields = target as ReportGlyphs;
  return {
    ...(fields.ligatures?.length ? { ligatures: [...fields.ligatures] } : {}),
    ...(fields.raws?.length ? { raws: [...fields.raws] } : {}),
    ...(fields.characters ? { characters: fields.characters } : {}),
    ...(fields.unicodeRanges?.length ? { unicodeRanges: [...fields.unicodeRanges] } : {}),
  };
}

export function describeMinified(buffer: Buffer, info: MinifiedInfo): void {
  minifiedInfo.set(buffer, info);
}

// Called for every emitted font; the original bytes of a failed minification are not listed
export function reportEmitted(ctx: PluginContext, content: Buffer, output: string): void {
  const info = minifiedInfo.get(content);
  if (!info) return;
  // Keys in the order the report shows them
  const { fontName, source, format, ...sizes } = info;
  ctx.addReportRecord({ kind: "font", fontName, source, format, output, ...sizes });
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byKeys =
  <T>(...keys: ((item: T) => string)[]) =>
  (a: T, b: T): number => {
    for (const key of keys) {
      const order = compare(key(a), key(b));
      if (order) return order;
    }
    return 0;
  };

const unique = <T>(items: T[]): T[] => [
  ...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
];

/**
 * The report of one output: fonts that are in it (a font the cleanup removed is not), sorted so
 * that the same build writes the same report.
 */
export function createReport(
  ctx: PluginContext,
  environment: string,
  bundle: Rollup.OutputBundle,
): FontReport {
  const fonts = unique(
    ctx.reportRecords.flatMap((record) => {
      if (record.kind !== "font") return [];
      const { kind: _, ...font } = record;
      return font.output === INLINE_OUTPUT || font.output in bundle ? [font] : [];
    }),
  ).sort(
    byKeys<ReportFont>(
      (font) => font.fontName,
      (font) => font.source,
      (font) => font.format,
      (font) => font.output,
      (font) => JSON.stringify(font.glyphs),
    ),
  );
  const skipped = unique(
    ctx.reportRecords.flatMap((record) => {
      if (record.kind !== "skipped") return [];
      const { kind: _, ...skip } = record;
      return [skip];
    }),
  ).sort(
    byKeys<ReportSkip>(
      (skip) => skip.fontName,
      (skip) => skip.source ?? "",
      (skip) => skip.reason,
    ),
  );
  const ignored = unique(
    ctx.reportRecords.flatMap((record) => {
      if (record.kind !== "ignored") return [];
      const { kind: _, ...face } = record;
      return [face];
    }),
  ).sort(
    byKeys<ReportIgnored>(
      (face) => face.fontName,
      (face) => face.id,
      (face) => face.reason,
    ),
  );
  const originalSize = fonts.reduce((sum, font) => sum + font.originalSize, 0);
  const minifiedSize = fonts.reduce((sum, font) => sum + font.minifiedSize, 0);
  return {
    version: PACKAGE_VERSION,
    mode: ctx.mode,
    environment,
    fonts,
    skipped,
    ...(ignored.length ? { ignored } : {}),
    totals: { originalSize, minifiedSize, saved: originalSize - minifiedSize },
  };
}

/**
 * Emits the report as an asset of the output (written with the bundle, part of `write: false`
 * results). A path outside the output directory is written to disk directly.
 */
export async function emitReport(
  emitter: Pick<Rollup.PluginContext, "emitFile">,
  path: string,
  outDir: string,
  report: FontReport,
): Promise<void> {
  const source = `${JSON.stringify(report, null, 2)}\n`;
  const file = resolve(outDir, path);
  const fileName = normalizePath(relative(outDir, file));
  if (fileName && fileName !== ".." && !fileName.startsWith("../") && !isAbsolute(fileName)) {
    emitter.emitFile({ type: "asset", fileName, source });
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}
