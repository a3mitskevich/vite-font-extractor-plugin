import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizePath, type ResolvedConfig, type ResolveFn } from "vite";
import { cleanUrl } from "./utils";
import { blankComments } from "./css-faces";

// Resolvers configured like the ones vite:css uses for urls and for imports of each language
export interface CssResolvers {
  url: ResolveFn;
  css: ResolveFn;
  sass: ResolveFn;
  less: ResolveFn;
}

// Vite resolves this condition to "development" or "production"
const DEV_PROD_CONDITION = "development|production";
const MAX_VISITED_FILES = 500;

export function createCssResolvers(config: ResolvedConfig): CssResolvers {
  const cache = new Map<keyof CssResolvers, ResolveFn>();
  const lazy =
    (key: keyof CssResolvers, create: () => ResolveFn): ResolveFn =>
    (...args) => {
      const resolver = cache.get(key) ?? create();
      cache.set(key, resolver);
      return resolver(...args);
    };
  return {
    url: lazy("url", () =>
      config.createResolver({ preferRelative: true, tryIndex: false, extensions: [] }),
    ),
    css: lazy("css", () =>
      config.createResolver({
        extensions: [".css"],
        mainFields: ["style"],
        conditions: ["style", DEV_PROD_CONDITION],
        tryIndex: false,
        preferRelative: true,
      }),
    ),
    sass: lazy("sass", () =>
      config.createResolver({
        extensions: [".scss", ".sass", ".css"],
        mainFields: ["sass", "style"],
        conditions: ["sass", "style", DEV_PROD_CONDITION],
        tryIndex: true,
        tryPrefix: "_",
        preferRelative: true,
      }),
    ),
    less: lazy("less", () =>
      config.createResolver({
        extensions: [".less", ".css"],
        mainFields: ["less", "style"],
        conditions: ["less", "style", DEV_PROD_CONDITION],
        tryIndex: false,
        preferRelative: true,
      }),
    ),
  };
}

const IMPORT_STATEMENT_RE = /@(?:import|use|forward|require)\b([^;{}]*)/g;
// Quoted strings and unquoted url() arguments
const TOKEN_RE = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1|url\(\s*([^'")\s][^)\s]*)\s*\)/g;
const FONT_PATH_RE = /\.(?:woff2?|ttf|otf|eot|svg)(?:[?#]|$)/i;
const REMOTE_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const LANG_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/;

const pickImportResolver = (resolvers: CssResolvers, file: string): ResolveFn => {
  const lang = LANG_RE.exec(file)?.[1];
  if (lang === "scss" || lang === "sass") return resolvers.sass;
  if (lang === "less") return resolvers.less;
  return resolvers.css;
};

const exists = (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

const readTokens = (code: string): string[] =>
  Array.from(code.matchAll(TOKEN_RE), (match) => match[2] ?? match[3]).filter(Boolean);

async function resolveFontToken(
  resolvers: CssResolvers,
  token: string,
  importers: string[],
): Promise<string[]> {
  const path = cleanUrl(token);
  const found = await Promise.all(
    importers.flatMap((importer) => [
      resolvers.url(path, importer).catch(() => undefined),
      Promise.resolve(resolve(dirname(importer), path)),
    ]),
  );
  const files = [
    ...new Set(
      found.filter((file): file is string => !!file).map((file) => normalizePath(cleanUrl(file))),
    ),
  ];
  const checked = await Promise.all(
    files.map(async (file) => ((await exists(file)) ? file : null)),
  );
  return checked.filter((file): file is string => !!file);
}

async function resolveImports(
  resolvers: CssResolvers,
  code: string,
  file: string,
): Promise<string[]> {
  const specifiers = Array.from(code.matchAll(IMPORT_STATEMENT_RE), (match) => readTokens(match[1]))
    .flat()
    .filter((specifier) => !REMOTE_RE.test(specifier) && !specifier.startsWith("sass:"));
  const resolveImport = pickImportResolver(resolvers, file);
  const resolved = await Promise.all(
    specifiers.map((specifier) => resolveImport(specifier, file).catch(() => undefined)),
  );
  return resolved.filter((id): id is string => !!id).map(cleanUrl);
}

// One file of a stylesheet's import tree: the font paths written in it, each resolved against the
// file itself, and the files it imports
interface CssFileScan {
  tokens: string[];
  fonts: string[][];
  imports: string[];
}

// File path → scan of the file as read from disk, shared by every module of a build importing it
export type CssFileScans = Map<string, Promise<CssFileScan | null>>;

async function scanCode(resolvers: CssResolvers, file: string, code: string): Promise<CssFileScan> {
  const cleaned = blankComments(code, true);
  const tokens = readTokens(cleaned).filter(
    (token) => FONT_PATH_RE.test(token) && !REMOTE_RE.test(token),
  );
  const [fonts, imports] = await Promise.all([
    Promise.all(tokens.map((token) => resolveFontToken(resolvers, token, [file]))),
    resolveImports(resolvers, cleaned, file),
  ]);
  return { tokens, fonts, imports };
}

function scanFile(
  resolvers: CssResolvers,
  file: string,
  scans: CssFileScans,
): Promise<CssFileScan | null> {
  const known = scans.get(file);
  if (known) return known;
  const scan = readFile(file, "utf8").then(
    (code) => scanCode(resolvers, file, code),
    () => null,
  );
  scans.set(file, scan);
  return scan;
}

/**
 * Font files a CSS module may have received from its imports: every font path written in the
 * module source and in the files it imports (`@import`, `@use`, `@forward`, `@require`), resolved
 * against the file that contains it and against the module (Sass mixins take paths as strings,
 * and Vite rebases urls of imported files to the module). An imported file is read and resolved
 * once per build (`scans`); only its font paths are resolved against each module.
 */
export async function collectFontFiles(
  resolvers: CssResolvers,
  id: string,
  code: string,
  scans: CssFileScans,
): Promise<string[]> {
  const entry = cleanUrl(id);
  const fonts = new Set<string>();
  const visited = new Set<string>([entry]);
  // The module source, not its file: a Vue style block or a pre transform differs from the file
  const queue: Array<{ file: string; scan: Promise<CssFileScan | null> }> = [
    { file: entry, scan: scanCode(resolvers, entry, code) },
  ];
  while (queue.length && visited.size <= MAX_VISITED_FILES) {
    const current = queue.shift()!;
    const scan = await current.scan;
    if (!scan) continue;
    const nearModule =
      current.file === entry
        ? []
        : await Promise.all(
            scan.tokens.map((token) => resolveFontToken(resolvers, token, [entry])),
          );
    scan.fonts.forEach((files, index) => {
      [...files, ...(nearModule[index] ?? [])].forEach((file) => fonts.add(file));
    });
    for (const imported of scan.imports) {
      if (visited.has(imported)) continue;
      visited.add(imported);
      queue.push({ file: imported, scan: scanFile(resolvers, imported, scans) });
    }
  }
  return [...fonts];
}
