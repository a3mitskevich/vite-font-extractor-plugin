# Vite font extractor plugin

**`vite-font-extractor-plugin`** is a vite plugin that to extracted glyphs from fonts that are used in applications and
change the original font files to minimized.

> [!IMPORTANT]
> The main goal of this plugin is a minimize fonts and save easy use way on the page and in frameworks.**

## Installation

To install vite-font-extractor-plugin use npm:

```bash
npm install vite-font-extractor-plugin
```

## Usage

### Config file:

```javascript
// vite.config.js
import FontExtractor from "vite-font-extractor-plugin";

const MaterialIconRegularTarget = {
 fontName: 'Material Icons',
 ligatures: ['abc, close'],
}

export default defineConfig({
 plugins: [
  FontExtractor({targets: MaterialIconRegularTarget}),
 ],
})
```

### Through JS import:

```javascript
// main.js
import Vue from 'vue';
import App from './App.vue';
import Vuetify from "vuetify";
// First way to import fonts
import 'material-design-icons-iconfont/dist/material-design-icons-no-codepoints.css';

Vue.use(Vuetify)

export function createApp() {
 const app = new Vue({
  vuetify: new Vuetify({
   icons: {
    iconfont: 'md',
   },
  }),
  render: (h) => h(App),
 });

 return {app};
}

createApp().app.$mount('#app');
```

### Through CSS import:

```scss
// App.scss
// Second way to import font
@import "material-design-icons-iconfont/dist/material-design-icons-no-codepoints.css";
```

### Through CSS file:

```scss
// material-design-icons-iconfont/dist/material-design-icons-no-codepoints.css
@charset "UTF-8";
@font-face {
  // See font name here
  font-family: 'Material Icons';
  src: url("./fonts/MaterialIcons-Regular.eot");
  src: url("./fonts/MaterialIcons-Regular.woff2") format("woff2"),
  url("./fonts/MaterialIcons-Regular.woff") format("woff"),
  url("./fonts/MaterialIcons-Regular.ttf") format("truetype");
  ...
}

.material-icons {
  ...
}

```

## Google fonts urls

Plugin additionally supports Google font url transformation to
enable [minification](https://developers.google.com/fonts/docs/getting_started?hl=en#optimizing_your_font_requests):

### Config file

```javascript
// vite.config.js
import FontExtractor from "vite-font-extractor-plugin";

const MaterialIconGoogleFontTarget = {
 // Warning: "+" sign from url should be transformed to plain space sign
 fontName: 'Material Icons', // 'Material+Icons' is wrong notation
 ligatures: ['play_arrow', 'close'],
}

export default defineConfig({
 plugins: [
  FontExtractor({targets: MaterialIconGoogleFontTarget}),
 ],
})
```

### CSS file

```css
/* Import throw css import */
@import "https://fonts.googleapis.com/icon?family=Material+Icons";
```

### HTML file

```html
<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <!-- Import throw html link tag -->
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons"
          rel="stylesheet">
</head>
<body>
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
```

## API

```
FontExtractor(pluginOption: PluginOption): Plugin
```

### PluginOption parameters:

* **targets** `Target[] | Target`: Targets for font extracting.
* **cache** `boolean | string | undefined`: Enable a minifying result cache.
* **logLevel** `LogLevel | undefined`: Setup a log level for plugin options. By default get a vite config logLevel.
* **apply** `"build" | "serve" | undefined`: Apply the plugin only for serve or build, or on certain conditions
* **ignore** `string[] | undefined`: Font names what will be ignored by plugin processing

### Target parameters:

* **fontName** `string`: The font filename that is to be extracted.
* **ligatures** `string[]`: An array of ligatures to extracted from the font.
* **withWhitespace** `boolean | undefined`: Set to true if you want to include whitespace glyphs in the font.

### Returns

* **Plugin**: plugin model for vite.

## License

`vite-font-extractor-plugin` is released under the MIT License. See the LICENSE file for details.

## Contributions

Contributions are welcome! If you find a bug or want to add a new feature, please open an issue or submit a pull
request.
