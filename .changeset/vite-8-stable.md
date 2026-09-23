---
"vite-font-extractor-plugin": minor
---

Stabilize Vite 5–8 support; Vite 8 is no longer experimental. This is the last release line with Vite 5–7 support.

- Fix Vite 8 bundles broken by a JS import with `?subset=` (undeclared identifier at runtime)
- Fix references to minified fonts: JS chunks, repeated urls in CSS and the manifest now point at emitted files
- Fix `@font-face` rules of one family backed by different files being replaced with one minified source
- Fix stale disk cache after a font file changes; unused cache entries are pruned after a build
- Skip SSR builds (no more "Asset not found" warnings)
- Faster builds: `transform` hook filter keeps the plugin out of unrelated modules
