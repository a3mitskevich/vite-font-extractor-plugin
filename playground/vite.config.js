import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import Vue2 from '@vitejs/plugin-vue2'
import Components from 'unplugin-vue-components/vite'
import { VuetifyResolver } from 'unplugin-vue-components/resolvers'
import FontExtractor from '../src'

const MaterialIconRegularTarget = {
  fontName: 'Material Icons',
  ligatures: ['close'],
  formats: ['eot', 'woff', 'woff2', 'ttf'],
}

export default defineConfig({
  plugins: [
    Vue2(),
    Components({ resolvers: [VuetifyResolver()] }),
    FontExtractor({ targets: MaterialIconRegularTarget, cache: './' }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~vuetify': fileURLToPath(new URL('./node_modules/vuetify', import.meta.url)),
    },
  },
  build: {
    manifest: true,
  },
})
