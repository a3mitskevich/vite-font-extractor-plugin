## 3.1.0

### Minor Changes

- d487698: Add `safariFix` option for icon and subset engines (via fontext 1.11.0 upgrade)
- d487698: Stabilize Vite 5–8 support; Vite 8 is no longer experimental. This is the last release line with Vite 5–7 support.

  - Fix Vite 8 bundles broken by a JS import with `?subset=` (undeclared identifier at runtime)
  - Fix references to minified fonts: JS chunks, repeated urls in CSS and the manifest now point at emitted files
  - Fix `@font-face` rules of one family backed by different files being replaced with one minified source
  - Fix a font file shared by several families with different options: each family now gets its own minified file (build and dev); in auto mode every family sharing a file points at the minified font
  - Fix dev server serving original fonts when `base` is not `/`
  - Fix `require()` resolving to the ESM build instead of `dist/index.cjs`
  - Fix stale disk cache after a font file changes; unused cache entries are pruned after a build; a `font-family` with path characters (`/`) is cached too
  - Skip SSR builds (no more "Asset not found" warnings)
  - Faster builds: `transform` hook filter keeps the plugin out of unrelated modules
  - Fix the dev server exiting on a minification error — the error is logged and the original font is served
  - Fix `build.cssCodeSplit: false`, inline `<style>` and `<link rel="preload">` pointing at removed fonts
  - Fix builds failing with `assetFileNames` without a directory; minified fonts now follow `assetFileNames`
  - Fix auto mode giving up when any `content` glyph is missing from the font, and parse `content` per CSS spec
  - Fix auto mode crashing the build on a `@font-face` with `?subset=`
  - Fix Google Fonts urls in one-line or minified HTML and css2 urls with several families
  - Fix `?subset=` decoding (`%20`, `%2C`, lower-case `u+`) and `ignore` for `?subset=` faces
  - Fix `?subset=` next to other query params (`?v=2&subset=…`): the font is minified and the other params stay on the url
  - Fix a JS `?subset=` import pointing at the wrong font on Vite 8 with a relative `base`
  - Fix stale references between `build --watch` rebuilds, and a stale font left after a JS `?subset=` import changes
  - Fix references to a file whose name ends with a minified font name (`x@icons.woff2`) with `assetFileNames` without `[hash]`
  - Manifest: keys and `src` stay source paths, `assets` lists the fonts a chunk actually loads (JS `?subset=` imports)
  - Implement the documented `apply` option; warn when `type` is not set (it falls back to `manual`)
  - Dev server: `?subset=` in CSS (also in auto mode), `?v=` in font urls and EOT fonts are minified; a failed font is retried on the next request
  - Fix fonts with an upper-case extension (`ICONS.WOFF2`) not being minified
  - Auto mode reads only `content` declarations, not selectors like `.content:hover` or `justify-content`
  - Keep `.otf` and eot-only fonts original with a warning instead of an error
  - Logs: reason of a failed minification, a warning for fonts inlined as `data:` URLs (also `?subset=` faces and imports), cached fonts in the summary

## 3.0.1

### Patch Changes

- 696a95c: Fix build compatibility with Vite 8 (rolldown) by removing unused rollup TransformPluginContext type dependency

  ### Other changes

  - Fix CI release workflow: add `NODE_AUTH_TOKEN` for npm publish, add `publishConfig.access: "public"` to package.json
  - Clean up `package-lock.json` — removed 496 extraneous dependencies
  - Add comprehensive `.gitattributes` for consistent line endings and binary file handling

## 3.0.0

### Major Changes

- c8d3782: ## v3.0.0

  ### Breaking Changes

  - Drop Vite 4 support (minimum: Vite 5)

  ### New Features

  - **Font subsetting via `?subset=`** — subset fonts by characters or Unicode ranges in CSS (`url('./font.woff2?subset=Hello')`) and JS imports (`import font from './font.woff2?subset=ABC'`)
  - **`ignore` option** — suppress "no minify options" warnings for fonts you don't want to process
  - **Structured logger** — tree formatting, progress bars, size comparisons, and build summary
  - **Live playground** — deployed to GitHub Pages with visual proof of font minification
  - Vite 7 and Vite 8 (Rolldown, experimental) support
  - Content-based font file hashing (output changes when config changes)
  - Google Font multi-family URL support (`family=Foo|Bar`)
  - Multiple `@font-face` blocks with same font name supported
  - Auto cache cleanup when `cache` option is disabled
  - Dev server font minification with in-flight request deduplication

  ### Improvements

  - Modular architecture: extractor.ts decomposed into 6 focused modules (transform, render-chunk, bundle, minify, serve, context)
  - Human-readable font names in logs (CSS font-family for subset fonts, readable filename for JS imports)
  - Replaced Math.random() with deterministic SID in auto mode
  - Replaced Proxy objects with explicit getters
  - Graceful degradation: failed font minification doesn't crash build
  - CSS comment stripping before regex parsing
  - Type-safe context accessors (no more `as any`)
  - Strict TypeScript in tests

  ### Infrastructure

  - Jest → Vitest (326+ tests)
  - ESLint → oxlint + oxfmt
  - Git hooks (pre-commit, commit-msg) via simple-git-hooks
  - Changesets for automated versioning and CHANGELOG
  - CI: lint + test in parallel, Node 20/22/24
  - GitHub Actions workflow for playground deployment

  ### Dependencies

  - fontext 1.2 → 1.10
  - Removed lodash.camelcase, lodash.groupby (native replacements)
  - Removed fast-glob (replaced with node:fs)
  - @tsconfig/node20 → @tsconfig/node22

## 2.0.0

- rework: transform flow and added serve minification
