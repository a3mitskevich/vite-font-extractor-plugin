import type { Formats } from "fontext";

export const PLUGIN_NAME = "vite-font-extractor-plugin";
export const CSS_LANGS_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
// Stops at quotes, whitespace, parens and tag brackets: works for attributes in any order,
// minified HTML and CSS url() without quotes
export const GOOGLE_FONT_URL_RE = /(?:https?:)?\/\/fonts\.googleapis\.com\/[^\s"'`()<>]+/g;
// Whether a text holds such a url at all, the host anchored like above
export const HAS_GOOGLE_FONT_URL_RE = /(?:https?:)?\/\/fonts\.googleapis\.com\//;
export const POSTFIX_URL_RE = /[?#].*$/s;
export const FONT_URL_REGEX = /url\(['"]?(.*?)['"]?\)/g;
export const FONT_FAMILY_RE = /font-family:\s*(.*?);/;
// Formats fontext can read a font from (eot and svg are output only)
export const SUPPORT_START_FONT_REGEX = /^(?:otf|ttf|woff2?|ttc|dfont)$/;
export const FONT_FACE_BLOCK_REGEX = /@font-face\s*{([\s\S]*?)}/g;
export const SUPPORTED_RESULTS_FORMATS: Formats[] = ["woff2", "woff", "svg", "eot", "ttf"];
export const FONT_MIME_TYPES: Partial<Record<Formats | "otf", string>> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  svg: "image/svg+xml",
};
