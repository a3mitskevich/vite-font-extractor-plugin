---
"vite-font-extractor-plugin": major
---

4.0: Vite 8 only, fontext 2, and a changed font renames every file that loads it. See "Migrating from 3.x" in the README.

Breaking changes:

- Require Vite 8 (`peerDependencies.vite: ^8.0.0`) and Node 22.13 or later; 3.x stays the line for Vite 5–7
- `FontExtractor()` returns an array of plugins (`plugins: [FontExtractor()]` keeps working)
- Minify with fontext 2: the `withWhitespace` target option is removed (a target that sets it fails with a hint — add `" "` to `characters`), and a ligature the font does not have fails the minification of that font, which keeps its original file
- A JS import without `?subset=` loads the original file instead of the result of an `@font-face` of the same file
- The disk cache moved from `node_modules/.font-extractor-cache` to `<config.cacheDir>/.font-extractor-cache`
- Fonts Vite inlines as `data:` URLs are minified and inlined instead of being skipped with a warning
- SSR builds are minified and point at the fonts of the client build

Features and fixes:

- Fonts are minified before the bundler hashes the output: the minified font, the CSS that loads it and the JS chunk that imports that CSS or font get new names, HTML and the manifest point at them; an unchanged build keeps every name. The finished bundle is no longer rewritten
- Deterministic minification: identical input gives byte-identical fonts, without a cache
- `assetFileNames` without `[hash]` keeps the original file name for a minified `@font-face`
- `@font-face` from Sass/Less partials, mixins and `@import` is minified before hashing too; the original Vite emitted for it is removed
- Auto mode collects the glyphs of the whole build, lazy chunks and CSS modules included, before a font is minified
- `new URL('./font.woff2?subset=…', import.meta.url)` is supported
- Dev server: JS `?subset=` imports are minified; auto-mode fonts get a new url and reload when stylesheets change their glyphs
- Google Fonts `text=` lists `characters`/`raws` of targets and the glyphs detected in auto mode (build; the dev server loads the full Google font for auto-mode families)
- `<link rel="preload">` follows the minified file of the CSS through Vite's own HTML processing
- The fontext version is part of the cache key; a build prunes only entries no build of another config and no dev server used within 30 days
- fontext warnings (`legacy-kern`) are logged
- Exact sourcemaps for chunks with a `?subset=` import
