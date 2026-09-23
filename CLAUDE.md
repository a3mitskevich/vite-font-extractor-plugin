# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vite plugin that extracts and minifies font glyphs — both icon fonts (by ligatures) and text fonts (by character subsetting). Supports Vite 5, 6, 7, and 8 (3.x is the last line with Vite 5–7; 4.0 will be Vite 8 only). Two modes: `auto` (detects CSS `content: "."` properties) and `manual` (user specifies ligatures/characters). Also handles Google Font URL optimization and `?subset=` query parameters in CSS and JS imports.

## Commands

- **Build:** `npm run build` (uses tsup, outputs CJS + ESM to `dist/`)
- **Test:** `npm test` (Vitest, 730+ tests, ~50 s)
- **Test against dist:** `npm run test:dist` (sets `TEST_TARGET=dist`)
- **Lint:** `npm run lint` (oxlint)
- **Format:** `npm run fmt` (oxfmt)
- **Format check:** `npm run fmt:check`

## Architecture

**Entry point:** `src/index.ts` re-exports from `src/extractor.ts`.

**`src/extractor.ts`** — Thin facade (~100 lines). Creates `PluginContext`, wires Vite hooks to module functions:
- `apply` — passes `pluginOption.apply` through
- `configResolved` — initializes logger, cache, import resolvers, `base`; warns when `type` is not set
- `applyToEnvironment` — client environment only (SSR builds are skipped)
- `configureServer` — mounts the dev middleware from `src/serve.ts`
- `buildStart` / `buildEnd` — reset and prune per-build state (`context.ts`); `build --watch` re-transforms only changed modules, so references are replaced per module instead of clearing everything
- `transform` (hook filter by id: styles, html, `?subset=`) → delegates to `src/transform.ts`
- `generateBundle` with `order: "post"` → delegates to `src/bundle.ts`; runs after Vite emits the single CSS (`cssCodeSplit: false`), HTML and the manifest

**`src/context.ts`** — `PluginContext` interface and `createPluginContext()` factory. Holds all shared state (maps, cache, logger, resolvers). Uses a getter-based auto target for auto mode (no Proxy) — its `fontName` getter throws, never spread it. Build state helpers: `resetBuildState`, `replaceModuleReferences`, `pruneBuildState`.

**`src/transform.ts`** — Processes CSS/HTML: extracts `@font-face` blocks, collects font references into `transformMap` (`FontReference` with `groupId` per @font-face), handles Google Font URLs and `?subset=` asset imports.

**`src/content-glyphs.ts`** — Parses CSS `content` strings for auto mode (quotes, 1–6 hex escapes, literals, ligature words).

**`src/glyph-filter.ts`** — Drops auto-detected glyphs the font doesn't contain (fontkit, GSUB ligatures) before calling fontext.

**`src/google-fonts.ts`** — Google Fonts URL handling (legacy `|` families, css2 `family=` with axes, `&text=`).

**`src/subset-options.ts`** — `?subset=` parsing from urls and `mergeSubsetOptions` shared by build and dev.

**`src/asset-refs.ts`** — Parses Vite asset placeholders in transformed code: `__VITE_ASSET__ref__$_?q__` (Vite 5–7), `__VITE_ASSET__ref__?q` and `import.meta.ROLLDOWN_FILE_URL_ref + "?q"` (Vite 8).

**`src/bundle.ts`** — `generateBundle` hook: resolves font assets by reference ID, groups them per @font-face + effective options, minifies via `fontext`, emits results by `name` (the bundler applies `assetFileNames`, identical results are emitted once), removes originals that are no longer referenced, prunes the cache.

**`src/inline-fonts.ts`** — Warns about target fonts inlined as `data:` URLs (`build.lib`, `assetsInlineLimit`).

**`src/output-font-face.ts`** — `@font-face` parsing in the output (family of a block) for per-family rewriting.

**`src/rewrite-refs.ts`** — Rewrites font file references (whole file-name tokens) in CSS/HTML assets and JS chunks per subset (`<name>?subset=X`, unminified `"<name>" + "?subset=X"`) and per family inside @font-face; a family without its own result keeps the original; updates `viteMetadata.importedAssets` for the manifest.

**`src/minify.ts`** — Core minification: calls `fontext.extract()`, manages disk cache, handles font resolution.

**`src/serve.ts`** — Dev server middleware and lazy minification (manual, auto, `?subset=`, `?v=`, non-root `base`, per-family urls `?font-extractor-family=`). Minification errors are logged and the original font is served — the dev server must never crash.

**`src/utils.ts`** — Regex extraction helpers, `camelCase`, `groupBy`, `stripCssComments`, `toError`.

**`src/cache.ts`** — Async file-system cache in `.font-extractor-cache/`, keyed by font content + options; entries unused by a build are pruned. Removed when cache is disabled.

**`src/internal-logger.ts`** — Structured logger with phases, progress bars, and build summary.

**`src/types.ts`** — All TypeScript interfaces. `PluginOption` is a discriminated union on `type: 'auto' | 'manual'`.

**Core dependencies:** `fontext` handles font extraction/subsetting; `fontkit` checks which glyphs a font contains.

## Testing

Tests run against four Vite versions (vite-5, vite-6, vite-7, vite-8 as aliased devDependencies). `tests/utils.ts` provides `buildByVersion()` which runs a full Vite build per version.

Test fixtures in `tests/fixtures/` — each subdirectory contains an `index.html` and CSS/SCSS/JS files. Fonts in `tests/fixtures/fonts/`: `icon-font.*` (Material Icons) and `text-font.*` (Roboto Latin).

Tests can import from `src/` (default) or `dist/` via `TEST_TARGET` env var.

**Test files:** common, auto, auto-content, google, google-markup, hash, subset, subset-query, references (output references resolve, manifest, SSR), build-config (cssCodeSplit, assetFileNames, preload, inline, log), configs (base, CDN, renderBuiltUrl, sourcemap, lightningcss, multi-output, CSS modules…), target-options, formats, cache, serve (dev on Vite 5–8), apply, watch, errors, options, patterns, logger, log, minificators, safariFix, dist-cjs, utils.

`tests/utils.ts` helpers: `findBrokenFontReferences` / `findOrphanFontAssets` (match by file base name, any `assetFileNames`/`base`), `getFontFilesByFamily`, `openFont`, `rendersLigature`, `hasGlyph`. Check font content with fontkit, not only sizes; `layout()` of a missing ligature in a WOFF throws — use `hasGlyphForCodePoint` there.

## Code Style

- oxlint with TypeScript, import, and promise rules (`oxlintrc.json`)
- oxfmt for formatting
- Git hooks: pre-commit (lint-staged), commit-msg (Conventional Commits)
- `strict: true` in both src and test tsconfigs
