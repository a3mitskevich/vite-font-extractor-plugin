import type { Formats } from "fontext";

export const PLUGIN_NAME = "vite-font-extractor-plugin";
export const CSS_LANGS_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
// Modules the transform hook cares about: styles, html and asset imports with `?subset=`
export const TRANSFORM_ID_INCLUDE = [CSS_LANGS_RE, /\.html$/, /[?&]subset=/];
export const GOOGLE_FONT_URL_RE = /["'](.+fonts.googleapis.com.+)["']/g;
export const POSTFIX_URL_RE = /[?#].*$/s;
export const FONT_URL_REGEX = /url\(['"]?(.*?)['"]?\)/g;
export const FONT_FAMILY_RE = /font-family:\s*(.*?);/;
export const SUPPORT_START_FONT_REGEX = /otf|ttf|woff|woff2|ttc|dfont/;
export const FONT_FACE_BLOCK_REGEX = /@font-face\s*{([\s\S]*?)}/g;
export const SUPPORTED_RESULTS_FORMATS: Formats[] = ["woff2", "woff", "svg", "eot", "ttf"];
