# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Vite plugin that extracts and minifies font glyphs by ligatures. Supports Vite 4, 5, and 6. Two modes: `auto` (detects CSS `content: "."` properties) and `manual` (user specifies ligatures). Also handles Google Font URL optimization by appending `&text=` params.

## Commands

- **Build:** `npm run build` (uses tsup, outputs CJS + ESM to `dist/`)
- **Test:** `npm test` (Jest with ESM via `--experimental-vm-modules`)
- **Test against dist:** `npm run test:dist` (sets `TEST_TARGET=dist`)
- **Lint:** `npm run lint`
- **Lint fix:** `npm run lint:fix`

## Architecture

**Entry point:** `src/index.ts` re-exports from `src/extractor.ts`.

**`src/extractor.ts`** — The main `FontExtractor()` function returning a Vite `Plugin`. Implements three Vite hooks:
- `configResolved` — initializes logger, cache, and import resolvers
- `configureServer` — adds middleware for dev server font proxying (minifies on-the-fly)
- `transform` — processes CSS/HTML files: extracts `@font-face` blocks, Google Font URLs, and unicode glyphs (auto mode). Emits replacement assets with `.fef` extension stubs
- `generateBundle` — resolves `.fef` stub assets, runs actual font minification via `fontext`, replaces stubs with minified buffers, cleans up originals

**`src/utils.ts`** — Regex-based extraction helpers (font faces, font names, Google URLs, unicode glyphs) and Vite resolver factories.

**`src/cache.ts`** — File-system cache in `.font-extractor-cache/` directory. Cache keys combine camelCased font name + SHA-256 hash of options + entry URL.

**`src/types.ts`** — All TypeScript interfaces. `PluginOption` is a discriminated union on `type: 'auto' | 'manual'`.

**`src/constants.ts`** — Regex patterns and format lists used across the codebase.

**Core dependency:** `fontext` library handles the actual font extraction/subsetting.

## Testing

Tests run against all three Vite versions simultaneously (vite-4, vite-5, vite-6 installed as aliased devDependencies). The test utility in `tests/utils.ts` provides `buildByVersion()` which runs a full Vite build per version with configurable fixtures.

Test fixtures live in `tests/fixtures/` — each subdirectory contains an `index.html` and CSS/SCSS files with font references pointing to `tests/fixtures/fonts/`.

Tests can import from either `src/` (default) or `dist/` via the `TEST_TARGET` env var.

## Code Style

- ESLint with `standard-with-typescript` config
- No strict boolean expressions, nullish coalescing rule is off
- `return-await` set to `"never"`
- Always-multiline comma dangle
- Test files (`*.spec.ts`) don't require explicit return types
