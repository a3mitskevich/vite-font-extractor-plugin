// Reads glyphs used by CSS `content` values: every string token outside of functions,
// with CSS escapes resolved. A word of 2+ letters/digits is kept whole as a ligature
// ("close"), anything else is split into single code points.

// Any `*content:` declaration, including custom properties like `--icon-content:`
const CONTENT_PROPERTY_RE = /content\s*:/g;
const HEX_ESCAPE_RE = /^[0-9a-fA-F]{1,6}/;
const LIGATURE_WORD_RE = /^[\p{L}\p{N}_-]+$/u;
const WHITESPACE_RE = /\s/;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;
const MAX_HEX_ESCAPE_LENGTH = 6;

interface Token {
  glyphs: string[];
  end: number;
}

const isValidCodePoint = (codePoint: number): boolean =>
  codePoint > 0 &&
  codePoint <= MAX_CODE_POINT &&
  (codePoint < SURROGATE_START || codePoint > SURROGATE_END);

function splitText(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      const codePoints = [...word];
      return codePoints.length > 1 && LIGATURE_WORD_RE.test(word) ? [word] : codePoints;
    });
}

// Resolves one `\...` escape starting at `start`; returns the glyph (if any) and the next index
function readEscape(code: string, start: number): { hex?: string; literal?: string; end: number } {
  const hex = HEX_ESCAPE_RE.exec(code.slice(start + 1, start + 1 + MAX_HEX_ESCAPE_LENGTH))?.[0];
  if (hex) {
    let end = start + 1 + hex.length;
    if (code.startsWith("\r\n", end)) end += 2;
    else if (WHITESPACE_RE.test(code[end] ?? "")) end += 1;
    return { hex, end };
  }
  const next = code.codePointAt(start + 1);
  if (next === undefined) return { end: start + 1 };
  const literal = String.fromCodePoint(next);
  // Escaped newline is a line continuation
  return literal === "\n" ? { end: start + 2 } : { literal, end: start + 1 + literal.length };
}

function readString(code: string, start: number): Token {
  const quote = code[start];
  const glyphs: string[] = [];
  let text = "";
  let index = start + 1;
  while (index < code.length && code[index] !== quote && code[index] !== "\n") {
    if (code[index] !== "\\") {
      text += code[index++];
      continue;
    }
    const escape = readEscape(code, index);
    index = escape.end;
    if (escape.literal) {
      text += escape.literal;
    } else if (escape.hex) {
      const codePoint = parseInt(escape.hex, 16);
      glyphs.push(...splitText(text));
      text = "";
      if (isValidCodePoint(codePoint)) glyphs.push(...splitText(String.fromCodePoint(codePoint)));
    }
  }
  glyphs.push(...splitText(text));
  return { glyphs, end: index + 1 };
}

// Glyphs of the value that starts at `start`, up to `;` or `}` outside of strings and functions
function readValue(code: string, start: number): string[] {
  const glyphs: string[] = [];
  let depth = 0;
  let index = start;
  while (index < code.length) {
    const char = code[index];
    if (char === '"' || char === "'") {
      const token = readString(code, index);
      if (depth === 0) glyphs.push(...token.glyphs);
      index = token.end;
      continue;
    }
    if (depth === 0 && (char === ";" || char === "}")) break;
    if (char === "(") depth++;
    if (char === ")") depth = Math.max(0, depth - 1);
    index++;
  }
  return glyphs;
}

export const findUnicodeGlyphs = (code: string): string[] =>
  Array.from(code.matchAll(CONTENT_PROPERTY_RE), (match) =>
    readValue(code, match.index + match[0].length),
  ).flat();
