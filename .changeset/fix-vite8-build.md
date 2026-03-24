---
"vite-font-extractor-plugin": patch
---

Fix build compatibility with Vite 8 (rolldown) by removing unused rollup TransformPluginContext type dependency

### Other changes

- Fix CI release workflow: add `NODE_AUTH_TOKEN` for npm publish, add `publishConfig.access: "public"` to package.json
- Clean up `package-lock.json` — removed 496 extraneous dependencies
- Add comprehensive `.gitattributes` for consistent line endings and binary file handling
