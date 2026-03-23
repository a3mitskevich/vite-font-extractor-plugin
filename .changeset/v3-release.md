---
"vite-font-extractor-plugin": major
---

## v3.0.0

### Breaking Changes
- Drop Vite 4 support (minimum: Vite 5)

### New Features
- Vite 7 and Vite 8 (Rolldown) support
- Content-based font file hashing (deterministic output)
- Google Font multi-family URL support (`family=Foo|Bar`)
- Multiple `@font-face` blocks with same font name supported
- Auto cache cleanup when `cache` option is disabled
- Dev server font minification with in-flight request deduplication

### Improvements
- Modular architecture: extractor.ts decomposed into 6 focused modules
- Replaced Math.random() with deterministic SID in auto mode
- Replaced Proxy objects with explicit getters
- Graceful degradation: failed font minification doesn't crash build
- CSS comment stripping before regex parsing
- Type-safe context accessors (no more `as any`)
- Strict TypeScript in tests

### Infrastructure
- Jest → Vitest
- ESLint → oxlint + oxfmt
- Git hooks (pre-commit, commit-msg) via simple-git-hooks
- Changesets for automated versioning and CHANGELOG
- CI: lint + test in parallel, Node 20/22/24

### Dependencies
- fontext 1.2 → 1.10
- Removed lodash.camelcase, lodash.groupby (native replacements)
- Removed fast-glob (replaced with node:fs)
- @tsconfig/node20 → @tsconfig/node22
