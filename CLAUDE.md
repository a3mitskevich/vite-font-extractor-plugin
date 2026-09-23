# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vite plugin that extracts and minifies font glyphs — both icon fonts (by ligatures) and text fonts (by character subsetting). Supports Vite 5, 6, 7, and 8 (3.x is the last line with Vite 5–7; 4.0 will be Vite 8 only). Two modes: `auto` (detects CSS `content: "."` properties) and `manual` (user specifies ligatures/characters). Also handles Google Font URL optimization and `?subset=` query parameters in CSS and JS imports.

## Commands

- **Build:** `npm run build` (uses tsup, outputs CJS + ESM to `dist/`)
- **Test:** `npm test` (Vitest, 370+ tests)
- **Test against dist:** `npm run test:dist` (sets `TEST_TARGET=dist`)
- **Lint:** `npm run lint` (oxlint)
- **Format:** `npm run fmt` (oxfmt)
- **Format check:** `npm run fmt:check`

## Architecture

**Entry point:** `src/index.ts` re-exports from `src/extractor.ts`.

**`src/extractor.ts`** — Thin facade (~100 lines). Creates `PluginContext`, wires Vite hooks to module functions:
- `configResolved` — initializes logger, cache, import resolvers
- `applyToEnvironment` — client environment only (SSR builds are skipped)
- `buildStart` — resets cache usage tracking
- `configureServer` — dev server middleware for on-the-fly font minification
- `transform` (hook filter by id: styles, html, `?subset=`) → delegates to `src/transform.ts`
- `generateBundle` → delegates to `src/bundle.ts`

**`src/context.ts`** — `PluginContext` interface and `createPluginContext()` factory. Holds all shared state (maps, cache, logger, resolvers). Uses getter-based auto target for auto mode (no Proxy).

**`src/transform.ts`** — Processes CSS/HTML: extracts `@font-face` blocks, collects font references into `transformMap` (`FontReference` with `groupId` per @font-face), handles Google Font URLs and `?subset=` asset imports.

**`src/asset-refs.ts`** — Parses Vite asset placeholders in transformed code: `__VITE_ASSET__ref__$_?q__` (Vite 5–7), `__VITE_ASSET__ref__?q` and `import.meta.ROLLDOWN_FILE_URL_ref + "?q"` (Vite 8).

**`src/bundle.ts`** — `generateBundle` hook: resolves font assets by reference ID, groups them per @font-face + subset, minifies via `fontext`, emits new assets with content-based hashes, removes originals that are no longer referenced, prunes the cache.

**`src/rewrite-refs.ts`** — Rewrites font file references in CSS/HTML assets and JS chunks per subset (`<name>?subset=X`, unminified `"<name>" + "?subset=X"`), updates `viteMetadata.importedAssets` for the manifest.

**`src/minify.ts`** — Core minification: calls `fontext.extract()`, manages disk cache, handles font resolution.

**`src/serve.ts`** — Dev server font processing (manual and auto mode lazy minification).

**`src/utils.ts`** — Regex extraction helpers, `camelCase`, `groupBy`, `stripCssComments`, `toError`.

**`src/cache.ts`** — Async file-system cache in `.font-extractor-cache/`, keyed by font content + options; entries unused by a build are pruned. Removed when cache is disabled.

**`src/internal-logger.ts`** — Structured logger with phases, progress bars, and build summary.

**`src/types.ts`** — All TypeScript interfaces. `PluginOption` is a discriminated union on `type: 'auto' | 'manual'`.

**Core dependency:** `fontext` library handles actual font extraction/subsetting.

## Testing

Tests run against four Vite versions (vite-5, vite-6, vite-7, vite-8 as aliased devDependencies). `tests/utils.ts` provides `buildByVersion()` which runs a full Vite build per version.

Test fixtures in `tests/fixtures/` — each subdirectory contains an `index.html` and CSS/SCSS/JS files. Fonts in `tests/fixtures/fonts/`: `icon-font.*` (Material Icons) and `text-font.*` (Roboto Latin).

Tests can import from `src/` (default) or `dist/` via `TEST_TARGET` env var.

**Test files:** common, auto, google, hash, subset, references (output references resolve, manifest, SSR), cache, serve, errors, options, patterns, logger, log, minificators, safariFix, utils.

## Code Style

- oxlint with TypeScript, import, and promise rules (`oxlintrc.json`)
- oxfmt for formatting
- Git hooks: pre-commit (lint-staged), commit-msg (Conventional Commits)
- `strict: true` in both src and test tsconfigs
