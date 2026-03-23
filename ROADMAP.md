# ROADMAP

Development roadmap for `vite-font-extractor-plugin` — v3.0.

> Priorities: **P0** — blocks release, **P1** — next release, **P2** — planned, **P3** — backlog.

---

## Open tasks

### Vite 8 (Rolldown) — Full Support
- **Priority:** P0
- **Status:** Experimental for `?subset=` feature. Icon font minification works. Subset has known issues.

**What works on Vite 8:**
- Icon font minification (ligatures, raws) — fully functional
- Content-based font hashing — generates correct hashed file names
- `generateBundle` asset replacement — compatible with Rolldown's API
- Dev server font minification — middleware works

**What doesn't work on Vite 8:**
1. **CSS `?subset=` query stripping** — `bundle.ts` regex replacement doesn't match Rolldown's CSS output format. `?subset=` remains in final CSS URLs.
   - Root cause: Rolldown generates CSS differently than Rollup — URL encoding, whitespace, or quote handling differs
   - Fix needed: investigate Rolldown's CSS output format and adapt regex in `bundle.ts` string asset replacement
2. **JS `?subset=` via renderChunk** — Rolldown inlines asset URLs as variable names (`text_font_default`) instead of string literals. `renderChunk` regex can't find URL patterns to strip `?subset=`.
   - Root cause: Rolldown's module linking resolves asset imports differently — uses variable references rather than string URLs in chunk code
   - Fix needed: investigate Rolldown's asset import transformation. May need `resolveId` or `load` hook instead of `renderChunk` for Rolldown
3. **JS asset deduplication** — same file with same `?subset=` may not deduplicate identically across Rollup and Rolldown
   - Fix needed: test and adapt composite key logic for Rolldown's reference ID format

**Steps to achieve full Vite 8 support:**
1. Build with Vite 8 and inspect raw CSS/JS output to understand Rolldown's exact format differences
2. Adapt `bundle.ts` CSS path replacement to handle Rolldown's output
3. Investigate alternative to `renderChunk` for JS subset stripping on Rolldown (possibly `resolveId` with `enforce: 'pre'`)
4. Add Vite 8-specific assertions in subset tests (not weaker — different)
5. Remove "Experimental" label from README

**Files:** `src/bundle.ts`, `src/render-chunk.ts`, `tests/subset.spec.ts`, `README.md`

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

### Features

#### JS import ?subset= in dev server
- **Priority:** P3
- Currently `renderChunk` only processes build mode
- Dev server doesn't intercept `import font from './font.woff2?subset=ABC'`
- Needed: add handling in `configureServer` middleware

---

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
