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

Vite plugin that **extracts only the glyphs you use** from font files — icon fonts, text fonts, or both. Supports Vite
5, 6, 7, and 8.

```
Before:  Material Icons   348 KB (all 2,000+ icons)
After:   Material Icons    12 KB (only 3 icons you need)   → 97% smaller
```

## Features

- **Icon font minification** — keep only the ligatures you use (Material Icons, FontAwesome, etc.)
- **Text font subsetting** — keep only specific characters via `?subset=` query
- **Zero-config auto mode** — detects glyphs from CSS `content: "..."` automatically
- **Google Fonts optimization** — appends `&text=` parameter for server-side subsetting
- **Works in build and dev** — minifies fonts on-the-fly during development
- **Vite 5–8 support** — compatible with both Rollup and Rolldown bundlers
- **Content-based hashing** — output filenames change when config changes (cache-safe)
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
font files.

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

### Via JS import

Useful for runtime font loading (Rive, Canvas, PDF generators):

```js
import fontUrl from './fonts/Roboto.woff2?subset=ABCabc'

// fontUrl is a clean URL to the subsetted font asset
rive.load({fonts: [fontUrl]})
```

### Via plugin config

```js
FontExtractor({
    type: 'manual',
    targets: [
        {
            fontName: 'Roboto',
            characters: 'ABCabc0123456789',
            engine: 'subset',
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

Multi-family URLs are supported: `family=Material+Icons|Roboto`.

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

The cache is automatically cleaned when `cache` is set to `false`.

## Vite Compatibility

| Vite | Status       |
|------|--------------|
| v5   | Stable       |
| v6   | Stable       |
| v7   | Stable       |
| v8   | Experimental |

> Vite 8 uses Rolldown instead of Rollup. Icon font minification works fully. The `?subset=` feature has known
> limitations — see [ROADMAP](./ROADMAP.md) for details.

## API Reference

```ts
import FontExtractor from 'vite-font-extractor-plugin'

FontExtractor(options ? : PluginOption)
:
Plugin
```

### PluginOption

| Option     | Type                                      | Default     | Description                               |
|------------|-------------------------------------------|-------------|-------------------------------------------|
| `type`     | `'auto' \| 'manual'`                      | `'auto'`    | Glyph detection strategy                  |
| `targets`  | `Target \| Target[]`                      | —           | Fonts to process. Required in manual mode |
| `cache`    | `boolean \| string`                       | —           | Enable disk cache (or custom path)        |
| `logLevel` | `'info' \| 'warn' \| 'error' \| 'silent'` | Vite config | Log verbosity                             |
| `apply`    | `'build' \| 'serve'`                      | both        | Restrict to build or dev mode             |
| `ignore`   | `string[]`                                | —           | Font names to skip entirely               |

### Target

| Option           | Type                 | Description                                      |
|------------------|----------------------|--------------------------------------------------|
| `fontName`       | `string`             | Must match `font-family` in CSS (without quotes) |
| `ligatures`      | `string[]`           | Icon names to keep (e.g. `['close', 'menu']`)    |
| `raws`           | `string[]`           | Raw Unicode characters to keep                   |
| `characters`     | `string`             | Characters string for text font subsetting       |
| `unicodeRanges`  | `string[]`           | Unicode ranges (e.g. `['U+0400-04FF']`)          |
| `engine`         | `'icon' \| 'subset'` | `icon` for icon fonts, `subset` for text fonts   |
| `withWhitespace` | `boolean`            | Include whitespace glyphs (default: `false`)     |

## Troubleshooting

**Font not being minified?**

- Check that `fontName` exactly matches the `font-family` value in your CSS `@font-face` (without quotes)
- Make sure the font isn't in the `ignore` list

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
