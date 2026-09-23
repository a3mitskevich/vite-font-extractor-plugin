# ROADMAP

Development roadmap for `vite-font-extractor-plugin` — v3.1.

> Priorities: **P0** — blocks release, **P1** — next release, **P2** — planned, **P3** — backlog.

---

## Open tasks

### v4.0 — Vite 8 only
- **Priority:** P1
- **Status:** Planned. 3.x is the last line supporting Vite 5–7.
- `peerDependencies.vite` → `^8.0.0`, `engines.node` aligned with Vite 8
- Remove `vite-5/6/7` aliases and the per-version test loops
- Drop compatibility guards duplicated from hook filters, use Rolldown types directly
- Move the disk cache to `config.cacheDir`
- Toolchain majors: vitest 5, TypeScript 6, tsup → tsdown, changesets 3, lint-staged 17
- Dev server: invalidate auto-mode fonts on HMR (`?v=` and non-root `base` are handled since 3.1)

---

### Testing

#### CSS Modules (.module.css)
- **Priority:** P2
- Vite natively supports CSS modules — verify `@font-face` inside `.module.css` is processed by plugin
- **Files:** create `tests/fixtures/css-modules/`, add tests

#### Emoji / non-BMP Unicode in auto mode
- **Priority:** P2
- Auto mode uses `GLYPH_REGEX` for `content: "..."` — verify emoji support (🔤, 🎵) and non-BMP characters (U+10000+)
- Depends on fontext support
- **Files:** create `tests/fixtures/auto-emoji/`, update `src/constants.ts` if needed

#### Deterministic font hashing
- **Priority:** P1
- **Status:** Root cause found, fix belongs to `fontext`
- svg2ttf writes the current time (second precision) into `head.created`/`head.modified` and `checkSumAdjustment`, so builds in different seconds produce different bytes and file hashes (woff2 660/664/672/676 B)
- **Needed:** pass svg2ttf's `ts` option in fontext (0 or `SOURCE_DATE_EPOCH`), then drop `retry` in `tests/hash.spec.ts` — `hash.spec.ts` already proves stability with a frozen `Date`
- `vitest.config.ts` blames parallel execution for nondeterminism — that comment is wrong, re-check whether `fileParallelism: false` is still needed

#### fontext security update
- **Priority:** P1
- `@xmldom/xmldom@0.7` (high severity advisories) comes via `svg2ttf@6.0.3`; `svg2ttf@6.1.0` uses the fixed `^0.9` — release a fontext patch, then bump it here

### Code Quality (from audit)

#### Break down large functions
- **Priority:** P3
- `transformHook` in `src/transform.ts` — still long, split the @font-face branch

#### Deduplicate test helpers
- **Priority:** P3
- `tests/references.spec.ts` and `tests/serve.spec.ts` define their own `rendersLigature`/font-by-family helpers — use the shared ones from `tests/utils.ts`

#### `new URL('…?subset=', import.meta.url)`
- **Priority:** P3
- Not supported (documented). Could be handled in `generateBundle` by finding `<font>?subset=X` in chunks and registering standalone groups by file name

### Features

#### JS import ?subset= in dev server
- **Priority:** P3
- `?subset=` in CSS works in dev since 3.1; JS imports with `?subset=` are still build only
- Dev server doesn't intercept `import font from './font.woff2?subset=ABC'`
- Needed: add handling in `configureServer` middleware

---

## Completed (v3.1)

- ~~Vite 8 (Rolldown) — full support, including `?subset=` in CSS and JS imports~~
- ~~JS `?subset=` import no longer breaks Vite 8 bundles (undeclared identifier)~~
- ~~Font references rewritten in CSS/HTML assets and JS chunks, per subset, every occurrence~~
- ~~Manifest points at minified fonts (`viteMetadata.importedAssets`)~~
- ~~@font-face of one family backed by different files minified separately~~
- ~~Disk cache keyed by font content, unused entries pruned~~
- ~~`transform` hook filter, SSR environment skipped, async cache I/O~~
- ~~`bundle` typed as `OutputBundle`, `renderChunk` hook removed~~
- ~~Dev dependencies updated (Vite 8.3, vitest 4.1, oxlint 1.85, oxfmt 0.70)~~
- ~~Coverage audit (76 scenarios, 19 defects) — all defects fixed except `new URL(…?subset=)` (documented)~~
- ~~Dev server never crashes on minification errors; `apply` implemented; warning when `type` is missing~~
- ~~`cssCodeSplit: false`, inline `<style>`, HTML preloads — `generateBundle` runs with `order: "post"`~~
- ~~`assetFileNames` honored (string and function)~~
- ~~Auto mode: CSS `content` parsed per spec, glyphs missing from a font skipped; `?subset=` in auto mode no longer crashes the build~~
- ~~Google Fonts: one-line / minified markup, css2 multi-family and axes~~
- ~~`?subset=`: percent-decoding, `%2C`, lower-case `u+`, spaces; `ignore` applies to `?subset=` faces~~
- ~~`build --watch` rebuilds keep references consistent~~
- ~~Dev: `?subset=` in CSS, `?v=`, EOT minified, per-family urls, non-root `base`~~
- ~~Logs: reason of a failed minification, warning for fonts inlined as `data:`, cached fonts in the summary; `.otf`/eot-only kept with a warning~~
- ~~Tests: 386 → 734, content checked with fontkit, build-config regressions on Vite 5–8, CJS dist~~

## Completed (v3.0)

### Infrastructure
- ~~.nvmrc (Node 24)~~
- ~~Jest → Vitest~~
- ~~ESLint → oxlint + oxfmt~~
- ~~Git hooks (pre-commit, commit-msg)~~
- ~~.gitmessage (Conventional Commits)~~
- ~~Changesets (automated CHANGELOG)~~
- ~~CI pipeline (lint + test parallel)~~

### Dependencies & Compatibility
- ~~All dependencies updated (fontext 1.10, TypeScript 5.9, etc)~~
- ~~lodash → native implementations~~
- ~~fast-glob → node:fs~~
- ~~Vite 7 support~~
- ~~Vite 8 (Rolldown) — icon font minification works~~
- ~~Vite 4 deprecated → dropped~~
- ~~@tsconfig/node20 → node22~~

### Architecture
- ~~Decompose extractor.ts → 6 modules~~
- ~~PluginContext with explicit dependencies~~
- ~~Content-based font hashing~~
- ~~Rolldown-compatible asset pipeline (delete + emitFile)~~
- ~~Proxy → explicit getters~~
- ~~null as any → type-safe accessors~~
- ~~Math.random() → deterministic SID~~

### Features
- ~~Font subsetting (?subset= in CSS and JS) — Vite 5/6/7~~
- ~~renderChunk for JS import subset — Vite 5/6/7~~
- ~~Google Fonts multi-family support~~
- ~~Multiple @font-face with same name~~
- ~~Auto cache cleanup when cache disabled~~
- ~~Graceful degradation on minification errors~~
- ~~Multiple different ?subset= for same source file~~

### Quality
- ~~Type safety: strict in tests, toError(), getLogger/getResolvers~~
- ~~326 tests, 13 files~~
- ~~Unit tests for regex parsing (37 tests)~~
- ~~Dev server tests~~
- ~~Error path tests~~
- ~~Plugin options tests~~
- ~~Hash consistency tests~~
- ~~Font import pattern tests (multi-weight, font-display, absolute path, dynamic import, new URL)~~
- ~~Subset tests (chars, range, combined, JS import, config, multi, dedup)~~
- ~~Logger tests (16 tests)~~
- ~~Sass @import → @use migration~~

### UX
- ~~Structured logger with progress bars and summary~~
- ~~Playground — full feature showcase~~
- ~~README with badges, quick start, subsetting, troubleshooting~~
