import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  format: ['cjs', 'esm'],
  clean: true,
  external: ['picocolors', 'fast-glob'],
  tsconfig: 'tsconfig.lib.json',
})
