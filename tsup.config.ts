import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  format: ["cjs", "esm"],
  clean: true,
  // import.meta.url in the CommonJS build
  shims: true,
  external: ["picocolors"],
  tsconfig: "tsconfig.lib.json",
});
