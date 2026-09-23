---
"vite-font-extractor-plugin": minor
---

Stabilize Vite 5–8 support; Vite 8 is no longer experimental. This is the last release line with Vite 5–7 support.

- Fix Vite 8 bundles broken by a JS import with `?subset=` (undeclared identifier at runtime)
- Fix references to minified fonts: JS chunks, repeated urls in CSS and the manifest now point at emitted files
- Fix `@font-face` rules of one family backed by different files being replaced with one minified source
- Fix a font file shared by several families with different options: each family now gets its own minified file (build and dev)
- Fix dev server serving original fonts when `base` is not `/`
- Fix `require()` resolving to the ESM build instead of `dist/index.cjs`
- Fix stale disk cache after a font file changes; unused cache entries are pruned after a build
- Skip SSR builds (no more "Asset not found" warnings)
- Faster builds: `transform` hook filter keeps the plugin out of unrelated modules
- Fix the dev server exiting on a minification error — the error is logged and the original font is served
- Fix `build.cssCodeSplit: false`, inline `<style>` and `<link rel="preload">` pointing at removed fonts
- Fix builds failing with `assetFileNames` without a directory; minified fonts now follow `assetFileNames`
- Fix auto mode giving up when any `content` glyph is missing from the font, and parse `content` per CSS spec
- Fix auto mode crashing the build on a `@font-face` with `?subset=`
- Fix Google Fonts urls in one-line or minified HTML and css2 urls with several families
- Fix `?subset=` decoding (`%20`, `%2C`, lower-case `u+`) and `ignore` for `?subset=` faces
- Fix stale references between `build --watch` rebuilds
- Implement the documented `apply` option; warn when `type` is not set (it falls back to `manual`)
- Dev server: `?subset=` in CSS, `?v=` in font urls and EOT fonts are minified
- Keep `.otf` and eot-only fonts original with a warning instead of an error
- Logs: reason of a failed minification, a warning for fonts inlined as `data:` URLs, cached fonts in the summary
