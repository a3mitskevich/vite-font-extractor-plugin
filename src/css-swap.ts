import { readFile } from "node:fs/promises";
import { basename, extname, relative } from "node:path";
import { MagicString } from "magic-string";
import { normalizePath, type Rollup } from "vite";
import { type PluginContext, getCssResolvers, getLogger } from "./context";
import { type CssUrl, findFontFaces } from "./css-faces";
import { collectFontFiles } from "./css-candidates";
import { resolveFaceOptions } from "./face-options";
import { emitFont, type FontSource, minifyFace, readFontSource, toCssUrl } from "./font-emit";
import type { TransformOutput } from "./css-pre-transform";
import { getInlinedFontMessage } from "./inline-fonts";
import { cleanUrl, getHash } from "./utils";

type SwapContext = Pick<Rollup.PluginContext, "emitFile" | "getFileName">;

// `__VITE_ASSET__<ref>__?subset=A` as vite:css leaves it in the compiled CSS
const ASSET_PLACEHOLDER_RE = /^__VITE_ASSET__([\w$]+)__(.*)$/s;
const DATA_URL_RE = /^data:[^;,]*;base64,(.*)$/s;

type CompiledUrl =
  | { kind: "asset"; url: CssUrl; referenceId: string; postfix: string }
  | { kind: "data"; url: CssUrl; bytes: Buffer }
  | { kind: "other"; url: CssUrl };

function parseCompiledUrl(url: CssUrl): CompiledUrl {
  const asset = ASSET_PLACEHOLDER_RE.exec(url.url);
  if (asset) return { kind: "asset", url, referenceId: asset[1], postfix: asset[2] };
  const data = DATA_URL_RE.exec(url.url);
  if (data) return { kind: "data", url, bytes: Buffer.from(data[1], "base64") };
  return { kind: "other", url };
}

function describeCompiledUrl(pluginContext: SwapContext, url: CompiledUrl): string {
  if (url.kind === "asset") return `asset ${pluginContext.getFileName(url.referenceId)}`;
  if (url.kind === "data") return `data: (${url.bytes.length} B)`;
  return `other ${url.url.url}`;
}

const stemOf = (file: string): string => basename(file, extname(file));

// Hash of the whole source: modules of one file (`?inline`, Vue style blocks) share a key only
// when their sources are equal
const CANDIDATES_KEY_HASH_LENGTH = 64;

// Font files the module may have received, memoized per build by file and source
async function getFontCandidates(ctx: PluginContext, id: string): Promise<string[]> {
  const code = ctx.rawSources.get(id) ?? (await readFile(cleanUrl(id), "utf8").catch(() => ""));
  const key = `${cleanUrl(id)}\0${getHash(code, CANDIDATES_KEY_HASH_LENGTH)}`;
  const known = ctx.fontCandidates.get(key);
  if (known) return known;
  const candidates = collectFontFiles(getCssResolvers(ctx), id, code, ctx.cssFileScans);
  ctx.fontCandidates.set(key, candidates);
  return candidates;
}

class SourceLocator {
  private candidates: Promise<string[]> | undefined;

  constructor(
    private readonly pluginContext: SwapContext,
    private readonly ctx: PluginContext,
    private readonly id: string,
  ) {}

  private getCandidates(): Promise<string[]> {
    this.candidates ??= getFontCandidates(this.ctx, this.id).then((files) => {
      getLogger(this.ctx).debug(
        () => `L2: candidates ${files.length ? files.join(", ") : "none"}`,
        this.id,
      );
      return files;
    });
    return this.candidates;
  }

  // Rolldown names identical bytes the same: a probe of the candidate gets the asset's name
  private async probe(file: string, fileName: string): Promise<boolean> {
    const referenceId = this.pluginContext.emitFile({
      type: "asset",
      name: basename(file),
      originalFileName: normalizePath(relative(this.ctx.root, file)),
      source: await readFontSource(this.ctx, file),
    });
    this.ctx.probeAssets.add(referenceId);
    const probed = this.pluginContext.getFileName(referenceId);
    getLogger(this.ctx).debug(
      () =>
        `L2: probe ${file} → ${probed} ${probed === fileName ? "matches" : "differs from"} ${fileName}`,
      this.id,
    );
    return probed === fileName;
  }

  private async locateAsset(referenceId: string): Promise<string | undefined> {
    const fileName = this.pluginContext.getFileName(referenceId);
    const extension = extname(fileName).toLowerCase();
    const sameFormat = (await this.getCandidates()).filter(
      (file) => extname(file).toLowerCase() === extension,
    );
    // Same-named candidates first; a name alone proves nothing (`Roboto` is in `Roboto-Bold`)
    const named = sameFormat.filter((file) => basename(fileName).includes(stemOf(file)));
    const others = sameFormat.filter((file) => !named.includes(file));
    for (const file of [...named, ...others]) {
      if (await this.probe(file, fileName)) return file;
    }
    getLogger(this.ctx).debug(
      `L2: no ${extension || "extensionless"} candidate is the source of ${fileName}`,
      this.id,
    );
    return undefined;
  }

  private async locateData(bytes: Buffer): Promise<string | undefined> {
    for (const file of await this.getCandidates()) {
      if ((await readFontSource(this.ctx, file)).equals(bytes)) {
        getLogger(this.ctx).debug(`L2: data: URL has the bytes of ${file}`, this.id);
        return file;
      }
    }
    getLogger(this.ctx).debug(
      `L2: no candidate has the bytes of a data: URL (${bytes.length} B)`,
      this.id,
    );
    return undefined;
  }

  async locate(url: CompiledUrl): Promise<FontSource | null> {
    if (url.kind === "asset") {
      const file = await this.locateAsset(url.referenceId);
      return file ? { file, query: url.postfix } : null;
    }
    if (url.kind === "data") {
      const file = await this.locateData(url.bytes);
      // A data: URL keeps no query; the rule that inlined the original inlines the result too
      return file ? { file, query: "?inline" } : null;
    }
    return null;
  }
}

const isEmittedByPlugin = (ctx: PluginContext, url: CompiledUrl): boolean =>
  (url.kind === "asset" && ctx.emittedFonts.has(url.referenceId)) ||
  (url.kind === "data" && ctx.inlinedFonts.has(getHash(url.url.url)));

/**
 * After vite:css: an @font-face the source did not show (Sass/Less imports, mixins, variables,
 * `@import` of CSS) already points at the original font Vite emitted. The plugin finds the source
 * file of that asset, emits the minified font and points the url at it; the original, now
 * unreferenced, is removed from the bundle (cleanup.ts). Vite hashes the CSS with the new name.
 */
export async function swapCompiledFaces(
  pluginContext: SwapContext,
  ctx: PluginContext,
  code: string,
  id: string,
  waitForGlyphs: () => Promise<void>,
): Promise<TransformOutput | null> {
  if (!code.includes("@font-face")) return null;
  const locator = new SourceLocator(pluginContext, ctx, id);
  const logger = getLogger(ctx);
  const output = new MagicString(code);
  for (const face of findFontFaces(code)) {
    const urls = face.urls.map(parseCompiledUrl);
    logger.debug(
      () =>
        `L2: @font-face "${face.family}" urls: ${urls.map((url) => describeCompiledUrl(pluginContext, url)).join(", ")}`,
      id,
    );
    if (urls.some((url) => isEmittedByPlugin(ctx, url))) {
      logger.debug(`L2: "${face.family}" was minified before vite:css (L1)`, id);
      continue;
    }
    const plain = face.urls.map((url) => url.url);
    const options = resolveFaceOptions(ctx, { family: face.family, urls: plain, report: true });
    const located = urls.filter((url) => url.kind !== "other");
    if (!options) continue;
    if (!located.length) {
      logger.debug(`L2: "${face.family}" has no asset or data: url — left as is`, id);
      continue;
    }
    if (options.auto) await waitForGlyphs();
    const sources = await Promise.all(located.map((url) => locator.locate(url)));
    if (located.some((url, index) => url.kind === "data" && !sources[index])) {
      getLogger(ctx).warn(getInlinedFontMessage(`Font "${face.family}"`));
      ctx.addReportRecord({
        kind: "skipped",
        fontName: face.family,
        reason: "the source of an inlined data: URL was not found — keeping original",
      });
    }
    for (const [index, url] of located.entries()) {
      if (url.kind !== "asset" || sources[index]) continue;
      const fileName = pluginContext.getFileName(url.referenceId);
      getLogger(ctx).warn(
        `Font "${face.family}": the source of ${fileName} was not` +
          " found among the files the stylesheet imports (a path built by interpolation?) — keeping original",
      );
      ctx.addReportRecord({
        kind: "skipped",
        fontName: face.family,
        reason: `the source of ${fileName} was not found — keeping original`,
      });
    }
    const found = sources.filter((source): source is FontSource => !!source);
    if (!found.length) continue;
    const minified = await minifyFace(ctx, { fontName: face.family, options, sources: found });
    for (const [index, url] of located.entries()) {
      const source = sources[index];
      const content = source && minified.get(source.file + source.query);
      if (!source || !content) continue;
      const emitted = await emitFont(pluginContext, ctx, source, content);
      logger.debug(`L2: "${face.family}" ${source.file} swapped for the minified font`, id);
      output.overwrite(url.url.start, url.url.end, toCssUrl(emitted));
    }
  }
  return output.hasChanged()
    ? { code: output.toString(), map: output.generateMap({ hires: "boundary", source: id }) }
    : null;
}
