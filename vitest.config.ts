import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    coverage: {
      reporter: ['lcovonly'],
    },
    testTimeout: 30_000,
  },
})
