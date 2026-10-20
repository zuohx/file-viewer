/**
 * Word stores symbols that come from a symbol face as private-use code points
 * (0xF000 + the font's own byte). Browsers do not ship Wingdings or Symbol, so
 * an unmapped glyph renders as a tofu box or a stray letter and shifts the rest
 * of the line. Translate the code points that are used as list bullets and
 * inline marks into ordinary Unicode characters instead.
 */

// Verified against the installed Wingdings face by comparing ink density and
// aspect ratio with the candidate glyph. U+2727 is the hollow four-pointed star
// that Wingdings 0xB2 draws; U+2726 is its filled twin and reads much heavier.
const WINGDINGS_GLYPHS: Record<number, string> = {
  0x6c: '\u25cf', // ● filled circle
  0x6d: '\u25cb', // ○ hollow circle
  0x6e: '\u25a0', // ■ filled square
  0x6f: '\u25a1', // □ hollow square
  0x75: '\u25c6', // ◆ filled diamond
  0xa7: '\u25aa', // ▪ small filled square
  0xa8: '\u25a1', // □ hollow square
  0xb2: '\u2727', // ✧ hollow four-pointed star
  0xd8: '\u27a2', // ➢ three-d arrowhead
  0xe8: '\u27a8', // ➨ heavy arrow
  0xfb: '\u2717', // ✗ ballot x
  0xfc: '\u2713', // ✓ check mark
  0xfd: '\u2612', // ☒ ballot box with x
  0xfe: '\u2611', // ☑ ballot box with check
};

// Symbol 0xE0..0xE3 are the plain geometric and legal marks, not arrows; the
// arrow block sits at 0xAC..0xAF, which Word rarely emits for list bullets.
const SYMBOL_GLYPHS: Record<number, string> = {
  0xa3: '\u2264', // ≤
  0xa7: '\u2663', // ♣
  0xa8: '\u2666', // ♦
  0xa9: '\u2665', // ♥
  0xaa: '\u2660', // ♠
  0xb3: '\u2265', // ≥
  0xb7: '\u2022', // •
  0xb9: '\u2260', // ≠
  0xbb: '\u2248', // ≈
  0xe0: '\u25c7', // ◇ hollow diamond
  0xe1: '\u27e8', // ⟨ mathematical left angle bracket
  0xe2: '\u00ae', // ® registered sign
  0xe3: '\u00a9', // © copyright sign
};

const WEBINGS_GLYPHS: Record<number, string> = {
  0x6c: '\u25cf', // ●
  0x6e: '\u25a0', // ■
  0xa7: '\u25aa', // ▪
  0xfe: '\u2611', // ☑
};

export function isPrivateUseCodePoint(codePoint: number): boolean {
  return (codePoint >= 0xf000 && codePoint <= 0xf0ff)
    || (codePoint >= 0xe000 && codePoint <= 0xf8ff);
}

function glyphTableFor(fontFamily?: string): Record<number, string> | null {
  if (!fontFamily) return null;
  const normalized = fontFamily.toLowerCase().replace(/[\s_-]/g, '');
  if (normalized.includes('wingdings')) return WINGDINGS_GLYPHS;
  if (normalized.includes('webdings')) return WEBINGS_GLYPHS;
  if (normalized.includes('symbol')) return SYMBOL_GLYPHS;
  return null;
}

/**
 * Maps one authored symbol character onto a Unicode glyph.
 *
 * `fontFamily` is the resolved font of the run that carries the character; when
 * it is a symbol face, the private-use prefix is stripped before lookup. An
 * unknown glyph is returned unchanged so that no text is lost.
 */
export function mapSymbolGlyph(char: string, fontFamily?: string): string {
  const codePoint = char.codePointAt(0);
  if (codePoint == null) return char;
  const table = glyphTableFor(fontFamily);
  const low = codePoint >= 0xf000 && codePoint <= 0xf0ff ? codePoint - 0xf000 : codePoint;
  if (table) {
    const mapped = table[low];
    if (mapped) return mapped;
  }
  // A private-use bullet in a body-text font is still a symbol; retry with the
  // shared Wingdings table, which covers the common Word bullet choices.
  if (codePoint >= 0xf000 && codePoint <= 0xf0ff) {
    return WINGDINGS_GLYPHS[low] ?? char;
  }
  return char;
}

/** Rewrites every private-use character in a string, keeping the rest intact. */
export function mapSymbolText(text: string, fontFamily?: string): string {
  let result = '';
  let changed = false;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!isPrivateUseCodePoint(codePoint)) {
      result += character;
      continue;
    }
    const mapped = mapSymbolGlyph(character, fontFamily);
    if (mapped !== character) changed = true;
    result += mapped;
  }
  return changed ? result : text;
}
