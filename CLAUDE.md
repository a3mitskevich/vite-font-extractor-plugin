# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vite plugin that extracts and minifies font glyphs — both icon fonts (by ligatures) and text fonts (by character subsetting). Requires Vite 8 and Node 22.13 (3.x is the line for Vite 5–7). Two modes: `auto` (detects CSS `content: "."` properties) and `manual` (user specifies ligatures/characters). Also handles Google Font URL optimization and `?subset=` query parameters in CSS, JS imports and `new URL()`. Minification runs through fontext 2 (deterministic output).

**Main goal — judge every change by it** (README → "Goal"): fonts keep only the glyphs the project needs; a changed minified result gives the font and every file depending on it (CSS, JS, HTML, manifest) new content-hashed names, so nothing needs revalidation; an unchanged result keeps every name, so caches survive. 4.0 meets it by minifying during `transform`/`load`, before Rolldown renders and hashes: the plugin emits the minified fonts itself and Vite/Rolldown name and reference them. Prefer solutions inside Rolldown/Vite mechanics over rewriting the finished bundle.

## Commands

- **Build:** `npm run build` (uses tsdown, outputs CJS + ESM to `dist/`)
- **Test:** `npm test` (Vitest, 320+ tests, files run in parallel, a few seconds)
- **Test against dist:** `npm run test:dist` (sets `TEST_TARGET=dist`)
- **Lint:** `npm run lint` (oxlint)
- **Format:** `npm run fmt` (oxfmt)
- **Format check:** `npm run fmt:check`

## Architecture

**Entry point:** `src/index.ts` re-exports from `src/extractor.ts`.

**`src/extractor.ts`** — Returns plugin objects sharing one `PluginContext`. Every per-module hook has a Rolldown hook filter (checked natively, no JS call for unrelated modules; `tests/edge-cases.spec.ts` asserts it):
- `:pre` (enforce pre): `resolveId`/`load` turn a JS `?subset=` font import into a module of the plugin (build); `transform` of CSS langs records the raw source and runs the L1 pass (build)
- `:new-url` (enforce pre, build): rewrites `new URL('<font>?subset=…', import.meta.url)` into an import
- main: `configResolved`, `configureServer` (dev middleware), `buildStart` (reset, auto-mode graph entries), `transform` of CSS langs after vite:css (L2 pass, auto glyphs, Google `@import`; dev: `transform.ts`), `watchChange` (dev: served urls of changed/deleted files, `serve-registry.ts`), `buildEnd` (auto-mode glyph check)
- `:graph` (auto-mode builds only): `moduleParsed` feeds the graph wait. It has no hook filter, so Rolldown calls it for every module — never register it where it is not needed
- `:html` (build): `transformIndexHtml` pre records the files HTML preloads
- `:post` (enforce post): `transformIndexHtml` post (Google Fonts, preloads follow the CSS), `generateBundle` — strict mode: targets that matched nothing (client builds, after Google Fonts of HTML), removes originals nothing loads before Vite's native manifest runs, emits the `report`, logs the summary, prunes the cache
- `include`/`exclude` (`isModuleIncluded`, Vite's `createFilter`): their RegExp excludes join the native filters of `:pre` transform and `:new-url`; handlers check the rest first. The L2 transform still collects auto glyphs of excluded stylesheets, `moduleParsed` is never filtered
- `applyToEnvironment`: every build environment (client, SSR); dev serves the browser only

**Why two CSS passes:** in Vite 8 CSS `url()` never reaches plugin `resolveId` (alias `customResolver` is deprecated). vite:css keeps urls that start with `__VITE_ASSET__`, and `css-post` resolves them when it renders the CSS, so the plugin can emit a font and write its placeholder.

**`src/css-pre-transform.ts`** — L1, before vite:css: an `@font-face` written in the module source gets its minified font emitted and `url(__VITE_ASSET__<ref>__)`. Vite never emits the original, so `[name][extname]` keeps the name. Dynamic faces (Sass variables, mixins) and auto mode are left to L2.

**`src/css-swap.ts`** — L2, after vite:css: a target face that points at an asset Vite emitted (partials, mixins, `@import`, auto mode). `SourceLocator` finds the source file: candidates from `css-candidates.ts`, matched by name or by a probe (Rolldown names identical bytes the same, `getFileName` works in `transform`); inlined `data:` sources by bytes. The swapped original is removed in `cleanup.ts`.

**`src/css-candidates.ts`** — `CssResolvers` built with the public `config.createResolver` like vite:css's (url, css, sass with `tryPrefix: "_"`, less) and `collectFontFiles`: font paths in the module and in everything it imports (`@import`/`@use`/`@forward`/`@require`).

**`src/css-faces.ts`** — `@font-face` blocks with url offsets (comments blanked, `//` for preprocessors); `isDynamic` for values a preprocessor computes.

**`src/face-options.ts`** — The one decision on a face (`FontFaceInfo`: family, urls, module id), shared by build (L1, L2), dev (`transform.ts`) and Google Fonts (`google-rewrite.ts`): `resolveFaceTarget` — `include`/`exclude`, `ignore`, first matching target, auto, then the user's `resolveTarget`; `resolveFaceOptions` adds `?subset=` alone, remote urls, reports, and the face's `ProblemReport`. Never look targets up by family elsewhere.

**`src/target-match.ts`** — Pure: targets compiled to matchers (`match` or `fontName`; RegExp without `g`/`y`), `ignore` predicates, target validation (unique `fontName`, removed options). `match` stays out of the sid, so it never changes output names.

**`src/strict-report.ts`** — `createProblemReport`: problems that leave a font unminified are logged, or thrown as `StrictModeError` in strict builds for a target (not for `?subset=` alone, never in dev).

**`src/font-emit.ts`** — `minifyFace` (formats of one face minified together per subset, memoized per build) and `emitFont` (emits like Vite: `name` = source basename, `originalFileName` = source path; inlined as `data:` where Vite would inline the original). `toCssUrl`/`toJsExpression`, `withoutSubsetParam`.

**`src/subset-import.ts`** — JS `?subset=` imports (`\0vite-font-extractor:` virtual module exporting `import.meta.ROLLDOWN_FILE_URL_<ref>`) and the `new URL()` rewrite.

**`src/graph-wait.ts`** — Auto mode: a module with an auto `@font-face` waits in `transform` until every discovered module is parsed (`moduleParsed` imports); externals have no module info. Watchdog after 20 s idle; `buildEnd` fails when a glyph was found after its font was emitted.

**`src/html.ts`** — Preloads: `transformIndexHtml` runs before Vite resolves the HTML's asset placeholders, so a preload gets the reference of the minified font.

**`src/report.ts`** — The `report` option. `minifyGroup` describes each minified buffer (`describeMinified`: font, source, format, sizes, `cached` from `processMinify`, glyphs of the options), `emitFont` turns it into a record with the output file name or `"inline"` (`ctx.reportRecords`, reset per build); skipped fonts come from `minifyGroup`, the `minifyFace` failure path and `css-swap.ts`. `generateBundle` (post, after the cleanup) keeps the fonts still in the bundle, dedupes and sorts them, and emits the JSON as an asset (`fileName` only, so the manifest skips it); a path outside the output directory is written with `fs`.

**`src/cleanup.ts`** — `generateBundle`: removes assets of minified sources, probes and minified fonts (a face the preprocessor dropped) that no chunk (`viteMetadata.importedAssets`) or text output references.

**`src/context.ts`** — `PluginContext` and `createPluginContext()`: options, per-build state (emitted fonts, minifications, graph, stats), dev state. Getter-based auto target (no Proxy) — its `fontName` getter throws, never spread or serialize it (`serve-registry.ts` keys requests by the options' sid); its `raws` are sorted. Target matchers, ignore matchers and `isModuleIncluded` are shared; `matchedTargets` (strict mode) is build state. `resetBuildState` runs on every (re)build start; Rolldown's `build --watch` transforms every module again.

**`src/transform.ts`** — Dev: auto glyphs, Google `@import`, faces registered with the middleware and tagged per family (and per glyph set in auto mode).

**`src/serve.ts`** — Dev middleware and lazy minification (manual, auto, `?subset=` in CSS and JS/`new URL`, `?v=`, non-root `base`, per-family urls); auto fonts reload through HMR when glyphs change. Minification errors are logged and the original font is served — the dev server must never crash.

**`src/serve-registry.ts`** — Dev: the urls each module registered with the middleware (`ctx.servedModules`). Every transform of a module drops its previous urls and registers them anew (within one transform the first face keeps a url; the plain url and the tagged url of a face share one loader, reused while its request stays the same). `watchChange` (main plugin) drops the urls of a changed file until it is transformed again, and everything of a deleted one (auto glyphs included).

**`src/content-glyphs.ts`** — Parses CSS `content` strings for auto mode (quotes, 1–6 hex escapes, literals, ligature words).

**`src/glyph-filter.ts`** — Drops auto-detected glyphs the font doesn't contain (fontkit, GSUB ligatures) before calling fontext. fontkit stays: fontext 2's Node entry exports only `extract`, its browser entry can not read WOFF2.

**`src/google-fonts.ts` / `src/google-rewrite.ts`** — Google Fonts URL handling (legacy `|` families, css2 `family=` with axes, `&text=` from ligatures, raws, characters or auto glyphs; dev adds no auto glyphs — HTML and a stylesheet are transformed before later stylesheets bring theirs, so auto families load the full Google font).

**`src/subset-options.ts`** — `?subset=` parsing from urls and `mergeSubsetOptions` shared by build and dev.

**`src/minify.ts`** — `processMinify`: calls `fontext.extract()`, disk cache (key: font, options, source hash, fontext version), fontext warnings.

**`src/cache.ts`** — Async file-system cache in `<config.cacheDir>/.font-extractor-cache`; `.usage/<owner>-<environment>.json` per build environment of a config (`<owner>.json` for the dev server): `usage(ctx.environmentName)` records the keys each environment uses, since client and SSR builds may run in parallel; each environment prunes when its build ends — writes only its own usage file (another one still running keeps the file of its last build) and removes entries no owner used within 30 days, protecting the in-memory keys of every environment of the process.

**`src/inline-fonts.ts`**, **`src/utils.ts`** (regex helpers, `camelCase`, `stripCssComments`, `toError`), **`src/internal-logger.ts`** (phases, progress bars, summary; `debug(message | () => message, id?)` prints dim `[debug]` info lines only when `debug: true` or `DEBUG` names `vite-font-extractor` — `isDebugEnabled` — with paths relative to the root: pass a thunk for anything costly, check `logger.isDebug` before extra work; one line per decision), **`src/types.ts`** (`PluginOption` is a discriminated union on `type: 'auto' | 'manual'`; public `FontFaceInfo`, `FaceMatcher`).

**Core dependencies:** `fontext` (extraction/subsetting, ESM only), `fontkit` (glyph checks), `magic-string` (source maps of rewritten modules).

## Testing

Tests run on Vite 8 (`vite` devDependency). `tests/utils.ts` provides `buildFixture()` which runs a full Vite build, and shared helpers: `findBrokenFontReferences` / `findOrphanFontAssets` (match by file base name, any `assetFileNames`/`base`), `getFontFilesByFamily`, `getEntryChunk`, `createFakeLogger`, `openFont`, `rendersLigature`, `hasGlyph`. Check font content with fontkit, not only sizes; `layout()` of a missing ligature in a WOFF throws — use `hasGlyphForCodePoint` there.

Test fixtures in `tests/fixtures/` — each subdirectory contains an `index.html` and CSS/SCSS/JS files. Fonts in `tests/fixtures/fonts/`: `icon-font.*` (Material Icons) and `text-font.*` (Roboto Latin).

Tests can import from `src/` (default) or `dist/` via `TEST_TARGET` env var.

**Test files:** debug (trace lines, `DEBUG` env), goal (names follow the minified fonts), common, auto, auto-content, auto-graph, google, google-markup, hash (determinism), subset, subset-query, references (output references resolve, manifest, SSR), build-config (cssCodeSplit, assetFileNames, preload, inline, log), configs (base, CDN, renderBuiltUrl, sourcemap, lightningcss, multi-output, CSS modules…), target-options, face-resolution (match, ignore, resolveTarget), module-filter (include/exclude), strict, formats, cache, serve (dev), apply, watch, errors, options, patterns, logger, log, minificators, safariFix, dist-cjs, utils.

## Code Style

- oxlint with TypeScript, import, and promise rules (`oxlintrc.json`)
- oxfmt for formatting
- Git hooks: pre-commit (lint-staged), commit-msg (Conventional Commits)
- `strict: true` in both src and test tsconfigs
