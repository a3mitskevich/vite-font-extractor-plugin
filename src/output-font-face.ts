// @font-face parsing of bundled CSS (already processed by Vite and the CSS minifier)
export const FONT_FACE_BLOCK_RE = /@font-face\s*\{[^}]*\}/g;

const FONT_FAMILY_DECLARATION_RE = /font-family\s*:\s*([^;}]+)/;

export const getBlockFamily = (block: string): string | undefined =>
  FONT_FAMILY_DECLARATION_RE.exec(block)?.[1].replace(/["']/g, "").trim();

// Minifiers may drop quotes or change spacing; CSS matches family names case-insensitively
export const normalizeFamily = (family: string): string =>
  family
    .replace(/["'\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
