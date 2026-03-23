import { defineConfig } from "vite";
import FontExtractor from "vite-font-extractor-plugin";

export default defineConfig({
  plugins: [
    FontExtractor({
      type: "manual",
      targets: [
        {
          fontName: "Material Icons",
          ligatures: [
            "close",
            "menu",
            "search",
            "home",
            "settings",
            "delete",
            "favorite",
            "star",
          ],
        },
      ],
      cache: true,
    }),
  ],
});
