import { basename } from "node:path";
import { MagicString } from "magic-string";
import type { Rollup } from "vite";
import { type PluginContext, type SharedContext, getLogger } from "./context";
import {
  emitFont,
  type FontSource,
  minifyFace,
  readFontSource,
  splitUrl,
  toJsExpression,
} from "./font-emit";
import { createProblemReport } from "./strict-report";
import { describeSubset, parseUrlSubset } from "./subset-options";
import { createSubsetOptions } from "./utils";

// `import url from './font.woff2?subset=ABC'`, other params may come first
export const SUBSET_IMPORT_RE = /\.(?:woff2?|ttf|otf|eot)\?(?:[^#]*&)?subset=/i;
export const VIRTUAL_PREFIX = "\0vite-font-extractor:";
export const VIRTUAL_ID_RE = /^\0vite-font-extractor:/;

type ResolveContext = Pick<Rollup.PluginContext, "resolve">;
type LoadContext = Pick<Rollup.PluginContext, "emitFile" | "getFileName" | "addWatchFile">;

/**
 * Build: a font import with `?subset=` becomes a module of the plugin, so the bundler never emits
 * the original for it — the module exports the url of the minified font like Vite's asset module
 * does, and the chunk is hashed with that url.
 */
export async function resolveSubsetImport(
  pluginContext: ResolveContext,
  ctx: SharedContext,
  source: string,
  importer: string | undefined,
): Promise<string | null> {
  const logger = getLogger(ctx);
  const { path, query } = splitUrl(source);
  const resolved = await pluginContext.resolve(path, importer, { skipSelf: true });
  if (!resolved || resolved.external) {
    const reason = resolved ? "external" : "not resolved";
    logger.debug(`subset import: ${source} is ${reason} — left to Vite`, importer);
    return null;
  }
  const file = splitUrl(resolved.id).path;
  logger.debug(`subset import: ${source} → ${file}${query} (module of the plugin)`, importer);
  return VIRTUAL_PREFIX + file + query;
}

export async function loadSubsetImport(
  pluginContext: LoadContext,
  ctx: PluginContext,
  id: string,
): Promise<string> {
  const { path: file, query } = splitUrl(id.slice(VIRTUAL_PREFIX.length));
  pluginContext.addWatchFile(file);
  const fontName = `subset (${basename(file)})`;
  const source: FontSource = { file, query };
  // `?subset=` of an import is the choice of that url alone: never a strict-mode failure
  const minified = await minifyFace(ctx, {
    fontName,
    options: createSubsetOptions(fontName, {}),
    sources: [source],
    reportProblem: createProblemReport(ctx, false),
  });
  // A failed minification keeps the original file, as for an @font-face
  const result = minified.get(file + query);
  getLogger(ctx).debug(
    () =>
      `subset import: load, ${describeSubset(parseUrlSubset(query))} → ` +
      (result ? `minified (${result.length} B)` : "original kept"),
    file,
  );
  const content = result ?? (await readFontSource(ctx, file));
  return `export default ${toJsExpression(await emitFont(pluginContext, ctx, source, content))};`;
}

// `new URL('./font.woff2?subset=A', import.meta.url)` with a literal url
const NEW_URL_RE =
  /new\s+URL\(\s*(['"`])([^'"`$]+?\.(?:woff2?|ttf|otf|eot)\?[^'"`]*?subset=[^'"`]*)\1\s*,\s*import\.meta\.url\s*\)/gi;
export const NEW_URL_CODE_RE = /new\s+URL\([^)]*subset=/;

/**
 * Build: rewrites `new URL('<font>?subset=…', import.meta.url)` into an import of the same url,
 * which the plugin resolves to the minified font. Vite's own `new URL` handling would emit the
 * original file with `?subset=` left on the url.
 */
export function rewriteNewUrlSubsets(
  ctx: SharedContext,
  code: string,
  id: string,
): Rollup.TransformResult {
  const output = new MagicString(code);
  const imports: string[] = [];
  for (const match of code.matchAll(NEW_URL_RE)) {
    getLogger(ctx).debug(`new URL: ${match[2]} rewritten into an import`, id);
    const name = `__vite_font_extractor_url_${imports.length}`;
    imports.push(`import ${name} from ${JSON.stringify(match[2])};`);
    output.overwrite(
      match.index,
      match.index + match[0].length,
      `new URL(${name}, import.meta.url)`,
    );
  }
  if (!imports.length) return null;
  // Imports are hoisted: appending them keeps the line numbers of the module
  output.append(`\n${imports.join("\n")}\n`);
  return { code: output.toString(), map: output.generateMap({ hires: "boundary", source: id }) };
}
