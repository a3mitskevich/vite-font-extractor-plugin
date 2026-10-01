# ROADMAP

Development roadmap for `vite-font-extractor-plugin` — v4.0.

> Priorities: **P0** — blocks release, **P1** — next release, **P2** — planned, **P3** — backlog.

---

## Open tasks

### Vite: plugin resolution of CSS `url()`
- **Priority:** P2
- CSS `url()` never reaches plugin `resolveId` in Vite 8 (vitejs/vite#14686), and `resolve.alias` `customResolver` is
  deprecated. 4.0 therefore minifies `@font-face` in two passes (before vite:css for faces written in the module,
  after it for partials/mixins/`@import`, with a lookup of the source file). Once Vite resolves CSS urls through
  plugins, collapse both passes into `resolveId`/`load` — faces from partials would then keep the original name with
  `assetFileNames` without `[hash]` too

### Fonts in `public/`
- **Priority:** P3
- Copied as is by Vite, never hashed: minifying them would change the bytes behind an unchanged url. Out of scope
  unless they move into the module graph

### Auto mode and plugins that load CSS modules themselves
- **Priority:** P3
- The `@font-face` module waits until every discovered module is parsed; a plugin that `this.load()`s that module
  from another module's transform delays it until the 20 s watchdog, and `buildEnd` then reports glyphs found late.
  No such plugin is known; revisit when a report comes in

---

## Completed (v4.0)

- ~~Vite 8 only: `peerDependencies.vite ^8.0.0`, Node 22.13, CI on Node 22/24; Vite 5–7 aliases, per-version test
  loops and compatibility guards removed~~
- ~~fontext 2: deterministic fonts (no retries or frozen clock in tests, test files run in parallel again),
  `withWhitespace` removed with a hint, failed ligatures keep the font original with the reason, `legacy-kern`
  warnings logged~~
- ~~**Main goal:** fonts are minified before Rolldown hashes the output; the plugin emits them and Vite/Rolldown name
  the font, the CSS, the JS chunk that imports it, HTML and manifest. Proven by `tests/goal.spec.ts`~~
- ~~`@font-face` in a module (pre-transform) and from Sass/Less partials, mixins, `@import` (after vite:css, source
  found through `config.createResolver` and Rolldown's content dedup, the original removed)~~
- ~~Auto mode waits for the whole module graph (lazy chunks, Sass variables, CSS modules), fails the build on a glyph
  found too late~~
- ~~`assetFileNames` without `[hash]` keeps the original file name of a minified `@font-face`~~
- ~~JS `?subset=` imports and `new URL('…?subset=', import.meta.url)` in build and dev~~
- ~~Dev: auto-mode fonts get a new url and reload through HMR when stylesheets change their glyphs~~
- ~~HTML preloads follow the CSS through `transformIndexHtml`~~
- ~~Fonts inlined by Vite (`build.lib`, `assetsInlineLimit`) are minified and inlined~~
- ~~SSR builds point at the client's minified fonts~~
- ~~Google Fonts `text=` for `characters`/`raws` targets and auto mode~~
- ~~Disk cache in `config.cacheDir`, fontext version in the key, pruning per build config and dev server~~
- ~~Exact sourcemaps after a `?subset=` url~~
- ~~Tests: goal, auto graph, CSS modules, emoji / non-BMP in auto mode, shared helpers; `transformHook` split~~
- ~~fontext security update: fontext 2 ships svg2ttf 6.1 with `@xmldom/xmldom` 0.9 (`npm audit` clean)~~
- ~~Toolchain: vitest 5, TypeScript 6, tsup → tsdown, changesets 3, lint-staged 17; playground on Vite 8~~

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
