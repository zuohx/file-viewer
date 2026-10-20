import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSymbolGlyph } from '../dist/msdoc/symbols.js';
import { renderMsDoc } from '../dist/render/html.js';

function paragraph(overrides = {}) {
  return {
    type: 'paragraph',
    id: 'p1',
    styleId: 0,
    styleName: '正文',
    paraState: {
      styleId: 0,
      alignment: 0,
      spacingBefore: 0,
      spacingAfter: 0,
      lineSpacing: 240,
      lineSpacingRule: 'auto',
      leftIndent: 0,
      rightIndent: 0,
      firstLineIndent: 0,
      keepLines: false,
      keepNext: false,
      pageBreakBefore: false,
      widowControl: false,
      inTable: false,
      tableRowEnd: false,
      innerTableCell: false,
      innerTableRowEnd: false,
      itap: 0,
      dtap: 0,
      rtlPara: false,
      adjustRight: false,
      borders: {},
      ...overrides,
    },
    inlines: [{ type: 'text', text: '递交信', style: { bold: false, italic: false, strike: false, underline: 0, spacing: 0, positionHalfPoints: 0, scale: 100, hidden: false, smallCaps: false, caps: false, outline: false, shadow: false, emboss: false, imprint: false, rtl: false, data: false, ole2: false, object: false, special: false } }],
    text: '递交信',
  };
}

const parseResult = blocks => ({
  kind: 'msdoc',
  version: 1,
  warnings: [],
  meta: {},
  fonts: [],
  styles: [],
  blocks,
  assets: [],
});

test('symbol faces translate Wingdings list bullets into Unicode', () => {
  // Wingdings 0xB2 is the hollow four-pointed star; U+2727 keeps its 1:1
  // aspect ratio, while the filled U+2726 reads far heavier.
  assert.equal(mapSymbolGlyph('\uf0b2', 'Wingdings'), '\u2727');
  assert.equal(mapSymbolGlyph('\uf06c', 'Wingdings'), '\u25cf');
  assert.equal(mapSymbolGlyph('\uf06e', 'Wingdings'), '\u25a0');
  assert.equal(mapSymbolGlyph('\uf0b7', 'Symbol'), '\u2022');
  // Latin text and unknown glyphs stay untouched.
  assert.equal(mapSymbolGlyph('A', 'Wingdings'), 'A');
  assert.equal(mapSymbolGlyph('\uf0ff', 'Wingdings'), '\uf0ff');
});

test('a list marker renders before the paragraph text with a dedicated hook', () => {
  const block = paragraph({ listId: 1, listLevel: 2, firstLineIndent: -900 });
  block.listMarker = { text: '\u2726', level: 2, kind: 'bullet', sourceFont: 'Wingdings' };
  const { html, css } = renderMsDoc(parseResult([block]));
  assert.match(html, /class="[^"]*msdoc-list-item/);
  assert.match(html, /<span class="msdoc-list-marker"[^>]*>\u2726<\/span>/);
  assert.match(html, /<\/span>\s*<span[^>]*>递交信<\/span>/);
  assert.match(css, /\.msdoc-list-marker\{/);
});

test('a hanging indent never pushes the first line outside the container', () => {
  // Word stores "left 0 / first line -900" for the usual bulleted item; the
  // raw value would start 60px left of the cell and cut the text off.
  const block = paragraph({ listId: 1, listLevel: 2, leftIndent: 0, firstLineIndent: -900 });
  block.listMarker = { text: '\u2726', level: 2, kind: 'bullet' };
  const { html } = renderMsDoc(parseResult([block]));
  assert.doesNotMatch(html, /text-indent:-60px/);
  assert.doesNotMatch(html, /margin-left:-/);
});

test('a hanging indent that stays inside the container is preserved', () => {
  // 1260 twips of left indent with a -900 twips first line still starts at
  // +360, so the authored hanging layout must survive.
  const block = paragraph({ leftIndent: 1260, firstLineIndent: -900 });
  const { html } = renderMsDoc(parseResult([block]));
  assert.match(html, /margin-left:84px/);
  assert.match(html, /text-indent:-60px/);
});

test('a negative left indent is clamped instead of rendering outside the page', () => {
  const block = paragraph({ leftIndent: -720, firstLineIndent: 0 });
  const { html } = renderMsDoc(parseResult([block]));
  assert.doesNotMatch(html, /margin-left:-/);
});
