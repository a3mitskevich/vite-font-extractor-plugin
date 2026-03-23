---
"vite-font-extractor-plugin": major
---

## v3.0.0

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
