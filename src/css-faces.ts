// @font-face blocks of a CSS module with source positions, so urls can be replaced in place.
// Comments are blanked (not removed) before matching — offsets in the result point at `code`

const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
// Sass/Less/Stylus line comments; `url(//cdn…)` and `https://` are not preceded by these characters
const LINE_COMMENT_RE = /(?<=^|[\s;{}])\/\/[^\n]*/g;
const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}]+)/;
const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
const URL_OPEN_LENGTH = "url(".length;
// Preprocessor variables, interpolation and custom properties are resolved only by the compiler
const DYNAMIC_VALUE_RE = /\$[\w-]|#\{|@\{|^\s*@[\w-]|var\(|~["']/;

export interface CssUrl {
  // Offsets of the url text inside `url(…)`, without quotes
  start: number;
  end: number;
  url: string;
}

export interface FontFaceBlock {
  family: string;
  // The family or a url is computed by a preprocessor and can not be read from the source
  isDynamic: boolean;
  urls: CssUrl[];
}

const blank = (match: string): string => match.replace(/[^\n]/g, " ");

export function blankComments(code: string, lineComments = false): string {
  const withoutBlocks = code.replace(BLOCK_COMMENT_RE, blank);
  return lineComments ? withoutBlocks.replace(LINE_COMMENT_RE, blank) : withoutBlocks;
}

export const unquoteFamily = (value: string): string => value.replace(/["']/g, "").trim();

function readUrls(block: string, offset: number): CssUrl[] {
  return Array.from(block.matchAll(URL_RE), (match) => {
    const url = match[2];
    const start = offset + match.index + match[0].indexOf(url, URL_OPEN_LENGTH);
    return { start, end: start + url.length, url };
  }).filter((item) => item.url.length > 0);
}

/**
 * @font-face blocks of `code`. `lineComments` also blanks `//` comments (preprocessor sources);
 * compiled CSS has only block comments.
 */
export function findFontFaces(code: string, lineComments = false): FontFaceBlock[] {
  const cleaned = blankComments(code, lineComments);
  return Array.from(cleaned.matchAll(FONT_FACE_RE), (match) => {
    const rawFamily = FONT_FAMILY_RE.exec(match[0])?.[1] ?? "";
    const urls = readUrls(match[0], match.index);
    return {
      family: unquoteFamily(rawFamily),
      isDynamic:
        DYNAMIC_VALUE_RE.test(rawFamily) || urls.some((item) => DYNAMIC_VALUE_RE.test(item.url)),
      urls,
    };
  });
}
