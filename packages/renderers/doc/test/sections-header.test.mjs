import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMsDoc, renderMsDoc } from '../dist/index.js';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = name => readFile(join(packageDir, 'test', 'fixtures', name));

test('section properties expose the authored page geometry', async () => {
  const parsed = parseMsDoc(await fixture('github-34-wps-table.doc'));
  assert.ok(Array.isArray(parsed.sections), 'sections should always be an array when the document declares one');
  for (const section of parsed.sections) {
    assert.ok(section.pageWidth > 0, 'page width must come from the SEPX block');
    assert.ok(section.pageHeight > 0, 'page height must come from the SEPX block');
    assert.ok(section.marginLeft >= 0 && section.marginRight >= 0);
  }
});

test('the header and footer stories are parsed separately from the body', async () => {
  const parsed = parseMsDoc(await fixture('github-236-wps-save.doc'));
  const bodyText = JSON.stringify(parsed.blocks);
  for (const block of parsed.header?.blocks ?? []) {
    assert.equal(block.type, 'paragraph');
    assert.ok(!bodyText.includes(block.id), 'header paragraphs must not be duplicated into the body');
  }
  for (const block of parsed.footer?.blocks ?? []) {
    assert.equal(block.type, 'paragraph');
    assert.ok(!bodyText.includes(block.id), 'footer paragraphs must not be duplicated into the body');
  }
});

test('a PAGE field renders as the first page instead of the cached result', () => {
  const pageNumber = (text) => ({
    type: 'paragraph',
    id: 'p-footer',
    styleId: 0,
    styleName: '页脚',
    paraState: {
      styleId: 0, alignment: 1, spacingBefore: 0, spacingAfter: 0, lineSpacing: 240,
      lineSpacingRule: 'auto', leftIndent: 0, rightIndent: 0, firstLineIndent: 0,
      keepLines: false, keepNext: false, pageBreakBefore: false, widowControl: false,
      inTable: false, tableRowEnd: false, innerTableCell: false, innerTableRowEnd: false,
      itap: 0, dtap: 0, rtlPara: false, adjustRight: false, borders: {},
    },
    inlines: [{
      type: 'text',
      text,
      style: {
        bold: false, italic: false, strike: false, underline: 0, spacing: 0,
        positionHalfPoints: 0, scale: 100, hidden: false, smallCaps: false, caps: false,
        outline: false, shadow: false, emboss: false, imprint: false, rtl: false,
        data: false, ole2: false, object: false, special: false,
      },
    }],
    text,
  });

  const rendered = renderMsDoc({
    kind: 'msdoc', version: 1, warnings: [], meta: {}, fonts: [], styles: [], assets: [],
    blocks: [],
    footer: { blocks: [pageNumber('第1页/共3页')] },
  });
  assert.match(rendered.html, /<footer class="msdoc-footer">/);
  assert.match(rendered.html, /第1页\/共3页/);
});
