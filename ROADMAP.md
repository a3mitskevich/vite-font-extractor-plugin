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
- Dev server: invalidate auto-mode fonts on HMR, match requests ignoring `?v=`/`?import` and `base`

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
- **Status:** Open issue
- fontext native encoders (ttf2woff2, ttf2eot) produce nondeterministic output — content-based hashing may differ between runs
- Tests use `retry: 5` as workaround
- **Needed:** investigate deterministic font subsetting or alternative hashing approach

### Code Quality (from audit)

#### Break down large functions
- **Priority:** P3
- `transformHook` in `src/transform.ts` (~110 lines) — extract Google Font processing

### Features

#### JS import ?subset= in dev server
- **Priority:** P3
- `?subset=` references are processed in build mode only
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
