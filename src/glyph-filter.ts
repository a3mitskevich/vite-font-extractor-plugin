import { create, type Font } from "fontkit";

// fontkit exposes GSUB without typings
interface LigatureSubTable {
  ligatureSets: { toArray(): Array<Iterable<{ glyph: number }>> };
}
interface GsubTable {
  lookupList: { toArray(): Array<{ lookupType: number; subTables: LigatureSubTable[] }> };
}

const LIGATURE_LOOKUP_TYPE = 4;

export interface IconGlyphs {
  raws: string[];
  ligatures: string[];
}

export interface IconGlyphsCheck extends IconGlyphs {
  // Entries the font has no glyph for, in input order
  missing: string[];
}

// Single code points are raw glyphs, longer texts are ligatures ("close")
export function splitGlyphTexts(texts: string[]): IconGlyphs {
  const unique = [...new Set(texts)];
  return {
    raws: unique.filter((text) => [...text].length === 1),
    ligatures: unique.filter((text) => [...text].length > 1),
  };
}

function openFont(source: Buffer): Font | null {
  try {
    const font = create(source);
    return "fonts" in font ? null : font;
  } catch {
    return null;
  }
}

// fontext resolves a raw glyph through the first subtable of the first GSUB ligature lookup,
// so only glyphs produced by that subtable can be kept by raws
function getLigatureGlyphIds(font: Font): Set<number> {
  const gsub = (font as unknown as { GSUB?: GsubTable }).GSUB;
  const lookup = gsub?.lookupList
    .toArray()
    .find((item) => item.lookupType === LIGATURE_LOOKUP_TYPE);
  const sets = lookup?.subTables[0]?.ligatureSets.toArray() ?? [];
  return new Set(sets.flatMap((set) => Array.from(set, (ligature) => ligature.glyph)));
}

const hasRaw = (font: Font, ligatureGlyphIds: Set<number>, raw: string): boolean => {
  const glyph = font.glyphForCodePoint(raw.codePointAt(0)!);
  return glyph.id !== 0 && ligatureGlyphIds.has(glyph.id);
};

const hasLigature = (font: Font, text: string): boolean => {
  try {
    const { glyphs } = font.layout(text);
    return glyphs.length === 1 && glyphs[0].id !== 0;
  } catch {
    // fontkit fails on WOFF layout of a missing ligature
    return false;
  }
};

/**
 * Splits glyphs into the ones the icon engine can extract from the font and the missing ones.
 * Returns null when the font can not be read — fontext reports that itself.
 */
export function checkIconGlyphs(source: Buffer, glyphs: IconGlyphs): IconGlyphsCheck | null {
  const font = openFont(source);
  if (!font) return null;
  const ligatureGlyphIds = getLigatureGlyphIds(font);
  const raws = glyphs.raws.filter((raw) => hasRaw(font, ligatureGlyphIds, raw));
  const ligatures = glyphs.ligatures.filter((text) => hasLigature(font, text));
  const missing = [...glyphs.raws, ...glyphs.ligatures].filter(
    (text) => !raws.includes(text) && !ligatures.includes(text),
  );
  return { raws, ligatures, missing };
}

const MAX_LISTED_GLYPHS = 10;
const HEX_PAD = 4;

// `U+002F, "close"`, shortened for long lists
export function formatGlyphs(glyphs: string[]): string {
  const listed = glyphs
    .slice(0, MAX_LISTED_GLYPHS)
    .map((text) =>
      [...text].length === 1
        ? `U+${text.codePointAt(0)!.toString(16).toUpperCase().padStart(HEX_PAD, "0")}`
        : `"${text}"`,
    );
  const rest = glyphs.length - listed.length;
  return listed.join(", ") + (rest > 0 ? ` and ${rest} more` : "");
}
