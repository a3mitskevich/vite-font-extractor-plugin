# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vite plugin that extracts and minifies font glyphs — both icon fonts (by ligatures) and text fonts (by character subsetting). Supports Vite 5, 6, 7, and 8 (experimental). Two modes: `auto` (detects CSS `content: "."` properties) and `manual` (user specifies ligatures/characters). Also handles Google Font URL optimization and `?subset=` query parameters in CSS and JS imports.

## Commands

- **Build:** `npm run build` (uses tsup, outputs CJS + ESM to `dist/`)
- **Test:** `npm test` (Vitest, 326+ tests)
- **Test against dist:** `npm run test:dist` (sets `TEST_TARGET=dist`)
- **Lint:** `npm run lint` (oxlint)
- **Format:** `npm run fmt` (oxfmt)
- **Format check:** `npm run fmt:check`

## Architecture

**Entry point:** `src/index.ts` re-exports from `src/extractor.ts`.

**`src/extractor.ts`** — Thin facade (~100 lines). Creates `PluginContext`, wires Vite hooks to module functions:
- `configResolved` — initializes logger, cache, import resolvers
- `configureServer` — dev server middleware for on-the-fly font minification
- `transform` → delegates to `src/transform.ts`
- `renderChunk` → delegates to `src/render-chunk.ts`
- `generateBundle` → delegates to `src/bundle.ts`

**`src/context.ts`** — `PluginContext` interface and `createPluginContext()` factory. Holds all shared state (maps, cache, logger, resolvers). Uses getter-based auto target for auto mode (no Proxy).

**`src/transform.ts`** — Processes CSS/HTML: extracts `@font-face` blocks, parses `?subset=` queries, collects font reference IDs into `transformMap`, handles Google Font URLs.

**`src/render-chunk.ts`** — Processes JS chunks: finds resolved font URLs with `?subset=`, strips query from output, stores subset info in `transformMap`.

**`src/bundle.ts`** — `generateBundle` hook: finds font assets by reference ID, minifies via `fontext`, emits new assets with content-based hashes, updates CSS/HTML paths, strips `?subset=` from CSS URLs.

**`src/minify.ts`** — Core minification: calls `fontext.extract()`, manages disk cache, handles font resolution.

**`src/serve.ts`** — Dev server font processing (manual and auto mode lazy minification).

**`src/utils.ts`** — Regex extraction helpers, `camelCase`, `groupBy`, `stripCssComments`, `toError`.

**`src/cache.ts`** — File-system cache in `.font-extractor-cache/`. Auto-cleanup when cache disabled.

**`src/internal-logger.ts`** — Structured logger with phases, progress bars, and build summary.

**`src/types.ts`** — All TypeScript interfaces. `PluginOption` is a discriminated union on `type: 'auto' | 'manual'`.

**Core dependency:** `fontext` library handles actual font extraction/subsetting.

## Testing

Tests run against four Vite versions (vite-5, vite-6, vite-7, vite-8 as aliased devDependencies). `tests/utils.ts` provides `buildByVersion()` which runs a full Vite build per version.

Test fixtures in `tests/fixtures/` — each subdirectory contains an `index.html` and CSS/SCSS/JS files. Fonts in `tests/fixtures/fonts/`: `icon-font.*` (Material Icons) and `text-font.*` (Roboto Latin).

Tests can import from `src/` (default) or `dist/` via `TEST_TARGET` env var.

**Test files:** common, auto, google, hash, subset, serve, errors, options, patterns, logger, utils.

## Code Style

- oxlint with TypeScript, import, and promise rules (`oxlintrc.json`)
- oxfmt for formatting
- Git hooks: pre-commit (lint-staged), commit-msg (Conventional Commits)
- `strict: true` in both src and test tsconfigs
