<p align="center">
  <img src="./assets/logo.png" alt="vite-font-extractor-plugin" width="500" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/vite-font-extractor-plugin?color=blue&label=npm" alt="npm version" />
  <img src="https://img.shields.io/npm/l/vite-font-extractor-plugin" alt="license" />
  <img src="https://img.shields.io/github/actions/workflow/status/a3mitskevich/vite-font-extractor-plugin/node.js.yml?branch=master&label=tests" alt="CI" />
  <img src="https://img.shields.io/npm/dm/vite-font-extractor-plugin" alt="downloads" />
</p>

# vite-font-extractor-plugin

Vite plugin that **extracts only the glyphs you use** from font files — icon fonts, text fonts, or both — and emits
them under content-hashed names, so they can be cached forever. Supports Vite 5, 6, 7, and 8.

```
Before:  Material Icons   348 KB (all 2,000+ icons)
After:   Material Icons    12 KB (only 3 icons you need)   → 97% smaller
```

## Goal

This is the outcome the plugin exists for, and every change is measured against it:

- **Smaller fonts** — each font keeps only the glyphs the project needs.
- **A new name for everything that changed** — when the minified result differs (another glyph set, another font
  file, other options), the font and every file that depends on it (CSS, JS, HTML preloads, manifest) get new
  content-hashed names. Nothing needs revalidation, nothing on a CDN needs invalidation.
- **The old name for everything that did not change** — when the result is the same, every file keeps its name, so
  browser and CDN caches keep working.

> **Status in 3.x:** the font files follow this rule (with [`cache`](#caching) kept between builds). CSS and JS that
> reference a font keep their names when only the font changes, so for now serve them with revalidation — see
> [Long-term caching](#long-term-caching). 4.0 minifies fonts before the bundler hashes the output, so Rollup /
> Rolldown rename the whole dependency chain themselves.

## Features

- **Cache-friendly file names** — a minified font is named by the hash of its content, so a changed font or glyph set
  gets a new file name and cached fonts never need invalidation; CSS/JS referencing them are not renamed yet
  ([details](#long-term-caching), [goal](#goal))
- **Icon font minification** — keep only the ligatures you use (Material Icons and other ligature icon fonts)
- **Text font subsetting** — keep only specific characters via `?subset=` query or target options
- **Zero-config auto mode** — detects glyphs from CSS `content: "..."` automatically
- **Google Fonts optimization** — appends `&text=` parameter for server-side subsetting
- **Works in build and dev** — minifies fonts on-the-fly during development
- **Vite 5–8 support** — compatible with both Rollup and Rolldown bundlers
- **Respects your build config** — `assetFileNames`, `base`, `cssCodeSplit`, manifest, HTML preloads
- **[Live playground](https://a3mitskevich.github.io/vite-font-extractor-plugin/)** — see the plugin in action
- **Disk cache** — skip re-minification on repeated builds

## Quick Start

```bash
npm install vite-font-extractor-plugin
```

### Zero-config (auto mode)

```js
// vite.config.js
import FontExtractor from 'vite-font-extractor-plugin'

export default defineConfig({
    plugins: [FontExtractor()],
})
```

The plugin scans all CSS for `content: "..."` declarations, collects referenced glyphs, and strips everything else from
font files:

- single and double quotes, escapes with 1–6 hex digits (`"\e5cd"`, `"\1F600"`), several glyphs in one value and
  literal characters are read; `counter()` / `attr()` are ignored
- a plain word such as `content: "close"` is treated as a ligature
- glyphs the font doesn't contain (e.g. `content: "/"` of a breadcrumb) are skipped with an info message; a font
  without any matching glyph is kept original with a warning — add such fonts to `ignore`

Auto mode keeps glyphs reachable through ligatures (Material Icons style). For icon fonts addressed only by code
points use `manual` mode with `unicodeRanges` or `raws`.

### Manual mode

Specify exactly which icons to keep:

```js
FontExtractor({
    type: 'manual',
    targets: [
        {
            fontName: 'Material Icons',
            ligatures: ['close', 'menu', 'search', 'home'],
        },
    ],
})
```

## Text Font Subsetting

Strip unused characters from text fonts like Roboto, Inter, or Open Sans.

### Via CSS `?subset=` query

```css
/* Keep only Latin letters and digits */
@font-face {
    font-family: 'Roboto';
    src: url('./fonts/Roboto.woff2?subset=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') format('woff2');
}

/* Keep a Unicode range (e.g. Cyrillic) */
@font-face {
    font-family: 'Roboto';
    src: url('./fonts/Roboto.woff2?subset=U+0400-04FF') format('woff2');
}

/* Combine characters and Unicode ranges */
@font-face {
    font-family: 'Roboto';
    src: url('./fonts/Roboto.woff2?subset=ABC,U+0400-04FF') format('woff2');
}
```

The value is a comma-separated list of characters and `U+` ranges (any case). Percent-encoding is decoded, so
`%20` requests a space and `%2C` a literal comma. `?subset=` works in build and dev, with or without a target —
characters of a target are merged with the query. In auto mode an explicit `?subset=` replaces the detected
glyphs of that `@font-face`.

### Via JS import

Useful for runtime font loading (Rive, Canvas, PDF generators):

```js
import fontUrl from './fonts/Roboto.woff2?subset=ABCabc'

// fontUrl is a clean URL to the subsetted font asset
rive.load({fonts: [fontUrl]})
```

`new URL('./fonts/Roboto.woff2?subset=…', import.meta.url)` is not supported — use an `import` as above.

The dev server serves a JS `?subset=` import as the full font; it is subsetted in build only. Dev support is
planned for 4.0.

The `?subset=` query is removed from the url after the bundle is rendered, so with `build.sourcemap` the columns
after it on the same line of a minified chunk are slightly off in the sourcemap.

### Via plugin config

```js
FontExtractor({
    type: 'manual',
    targets: [
        {
            fontName: 'Roboto',
            characters: 'ABCabc0123456789',
            engine: 'subset', // required for `characters`
        },
    ],
})
```

## Google Fonts

The plugin appends `&text=` to Google Font URLs, letting Google's servers do the subsetting:

```html
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
```

```css
@import "https://fonts.googleapis.com/icon?family=Material+Icons";
```

`<link>` attributes may come in any order and the HTML may be minified. Supported are the legacy multi-family
form `family=Material+Icons|Roboto` and the css2 API with several `family=` parameters and axes
(`family=Roboto:wght@400;700`).

## Build Output

- Minified fonts are emitted through the bundler, so `build.rollupOptions.output.assetFileNames` (string or function)
  names them. Every reference is rewritten — CSS (including `cssCodeSplit: false` and inline `<style>`), JS chunks,
  HTML preloads and the manifest (`file` and `assets`; keys and `src` stay source paths); the original file is
  removed only when nothing references it anymore.
- A font file shared by several `font-family` rules is minified per family options. A family without its own target
  keeps pointing at the full original file.
- Fonts inlined as `data:` URLs (`build.lib`, large `build.assetsInlineLimit`) can't be minified — the plugin warns
  about them. Keep fonts as files:
  `assetsInlineLimit: (file) => (/\.(woff2?|ttf|eot)$/.test(file) ? false : undefined)`.
- Fonts in `public/` are copied as is and are not processed.
- `.otf` can't be written by the minifier — other formats of the `@font-face` are minified and the `.otf` is kept
  original with a warning. A font available only as `.eot` is kept original too.
- SSR builds are skipped: fonts are emitted by the client build. The SSR bundle keeps the original font urls, which
  the client build replaces with minified files — take font urls for preloads from the client build or its manifest.

## Long-term caching

Minified fonts can be served with `Cache-Control: public, max-age=31536000, immutable` and never invalidated on a CDN:
new content always comes under a new file name.

- The plugin emits each result under the name of its source font, and the bundler names the file by
  `assetFileNames`. Vite's default `assets/[name]-[hash][extname]` hashes the bytes of the minified font.
- Every reference (CSS, JS, HTML preloads, manifest) is rewritten to the new name in the same build.
- The CSS and JS files that reference a font are **not** renamed. The bundler hashes them before the plugin rewrites
  the font url, and at that point they contain the original font name. When only the glyph set changes (a ligature
  added to `targets`, an icon used in a template), `index-<hash>.css` keeps its name but points at the new font.
  Serve CSS and JS with revalidation (`no-cache` or `must-revalidate`) rather than `immutable`, or keep the fonts of
  previous deploys available. Renaming them together with the font is planned for 4.0.

| Change between builds                                                          | File name     |
|--------------------------------------------------------------------------------|---------------|
| An icon added or removed, new `characters` / `unicodeRanges` / `?subset=`, new CSS `content` in auto mode | New hash      |
| The font file replaced                                                         | New hash      |
| Nothing changed, `cache` enabled and kept between builds                       | Same hash     |
| Nothing changed, no cache                                                      | May change    |

- The name carries a hash only when `assetFileNames` has `[hash]`. With `[name][extname]` the minified font is emitted
  while the original still holds its name, so the bundler adds a number (`icons2.woff2`), and the CDN has to be
  invalidated. Keeping the original name is planned for 4.0.
- Icon fonts are built through svg2ttf, which writes the build time (one second resolution) into the font. Without a
  cache, two builds of the same glyphs in different seconds get different hashes — clients download the same font
  again, though a stale font is never served under an old name. Enable [`cache`](#caching) and keep its directory
  between CI builds to keep file names stable.

## Caching

Enable disk cache to skip re-minification when fonts and config haven't changed:

```js
FontExtractor({
    type: 'manual',
    targets: [{fontName: 'Material Icons', ligatures: ['close']}],
    cache: true,              // caches in node_modules/.font-extractor-cache
    // cache: './my-cache',   // or a custom path
})
```

Cache entries are keyed by the font file content and the target options, so replacing a font file never
returns a stale result. Entries not used by the latest build are removed after it finishes. When `cache` is
disabled, the default `node_modules/.font-extractor-cache` directory is removed; a custom cache path is left as is.

Minified bytes include a creation timestamp of the font, so two builds made in different seconds may produce
different file hashes — the cache keeps them stable between builds.

## Vite Compatibility

| Vite | Status |
|------|--------|
| v5   | Stable |
| v6   | Stable |
| v7   | Stable |
| v8   | Stable |

> Vite 8 uses Rolldown instead of Rollup — icon fonts, text fonts and `?subset=` (CSS and JS imports) work on
> both bundlers. The plugin runs only for the client environment, SSR builds are skipped.
>
> **3.x is the last release line with Vite 5–7 support.** The next major (4.0) will support Vite 8 only.

## API Reference

```typescript
import FontExtractor from 'vite-font-extractor-plugin'

FontExtractor(options?: PluginOption): Plugin
```

### PluginOption

| Option     | Type                                      | Default     | Description                               |
|------------|-------------------------------------------|-------------|-------------------------------------------|
| `type`     | `'auto' \| 'manual'`                      | see below   | Glyph detection strategy                  |
| `targets`  | `Target \| Target[]`                      | —           | Fonts to process. Required in manual mode |
| `cache`    | `boolean \| string`                       | —           | Enable disk cache (or custom path)        |
| `logLevel` | `'info' \| 'warn' \| 'error' \| 'silent'` | Vite config | Log verbosity                             |
| `apply`    | `'build' \| 'serve'`                      | both        | Restrict to build or dev mode             |
| `ignore`   | `string[]`                                | —           | Font names to skip entirely               |

- `type`: `FontExtractor()` without arguments runs in `auto` mode. An options object without `type` falls back to
  `manual` and logs a warning — set `type` explicitly.
- `logLevel` has no effect when Vite runs with a `customLogger`: messages go to that logger unfiltered.
- `ignore` also applies to `@font-face` rules with `?subset=`.

### Target

| Option           | Type                 | Description                                              |
|------------------|----------------------|----------------------------------------------------------|
| `fontName`       | `string`             | Must match `font-family` in CSS (without quotes)         |
| `ligatures`      | `string[]`           | Icon names to keep (e.g. `['close', 'menu']`)            |
| `raws`           | `string[]`           | Raw Unicode characters to keep                           |
| `characters`     | `string`             | Characters to keep; requires `engine: 'subset'`          |
| `unicodeRanges`  | `string[]`           | Unicode ranges (e.g. `['U+0400-04FF']`)                  |
| `engine`         | `'icon' \| 'subset'` | `icon` for icon fonts (default), `subset` for text fonts |
| `withWhitespace` | `boolean`            | Include whitespace glyphs (default: `false`)             |
| `safariFix`      | `boolean`            | Align vertical metrics for Safari rendering              |
| `silent`         | `boolean`            | Suppress minifier output for this font                   |

## Troubleshooting

**Font not being minified?**

- Check that `fontName` exactly matches the `font-family` value in your CSS `@font-face` (without quotes)
- Make sure the font isn't in the `ignore` list
- A warning about a `data:` URL means the font was inlined — see [Build Output](#build-output)
- The reason of a failed minification is printed after `Failed to minify "<font>" — keeping original:`

**Warning: "has no minify options"?**

- The plugin found a `@font-face` but the font isn't in `targets`
- Fonts with `?subset=` URLs don't trigger this warning — they're processed automatically
- To silence: add the font to `targets`, use `?subset=`, or add to `ignore`

**Google Font URL not transformed?**

- Use spaces in `fontName`: `'Material Icons'`, not `'Material+Icons'`

**Auto mode missing glyphs?**

- Auto mode only detects glyphs from CSS `content: "..."` properties
- If icons are referenced by class name or JS, use `manual` mode instead

## License

[MIT](./LICENSE)

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/a3mitskevich/vite-font-extractor-plugin).
