import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // `type: module`: dist/index.js, dist/index.cjs and their .d.ts/.d.cts, as package.json exports them
  fixedExtension: false,
  // import.meta.url in the CommonJS build
  shims: true,
  tsconfig: "tsconfig.lib.json",
  // require() gets `.default` and `.FontExtractor`, like the ESM build
  outputOptions: { exports: "named" },
});
