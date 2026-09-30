export const isDataUrl = (url: string): boolean => url.startsWith("data:");

// `subject`: `Font "Icons"` or a font path
export const getInlinedFontMessage = (subject: string): string =>
  `${subject} is inlined as a data: URL and its source file was not found, so it is not minified. ` +
  "Exclude font files from inlining (build.assetsInlineLimit) to minify them";
