import type { FibRgFcLcb, MsDocSection } from '../types.js';

/**
 * Section properties (paper size and margins) live in SEPX blocks that the
 * PlcfSed table stream points at. Without them the renderer has to guess a page
 * geometry, which is why a legacy .doc ends up with different margins from the
 * same document saved as .docx.
 */

const SED_SIZE = 12;
const SEPX_MAX_BYTES = 4096;

/** spra -> operand byte length, per MS-DOC 2.6.1. */
const SPRM_OPERAND_SIZES = [1, 1, 2, 4, 2, 2, -1, 3] as const;

const PAGE_SPRMS: Record<number, keyof Omit<MsDocSection, 'cpStart' | 'cpEnd'>> = {
  0xb01f: 'pageWidth',
  0xb020: 'pageHeight',
  0xb021: 'marginLeft',
  0xb022: 'marginRight',
  0x9023: 'marginTop',
  0x9024: 'marginBottom',
  0x9025: 'gutter',
  0x9027: 'headerDistance',
  0x9028: 'footerDistance',
};

function u8(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function i16(bytes: Uint8Array, offset: number): number {
  const value = u16(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function applySprms(grpprl: Uint8Array, target: MsDocSection): void {
  let offset = 0;
  while (offset + 2 <= grpprl.length) {
    const sprm = u16(grpprl, offset);
    offset += 2;
    const spra = (sprm >> 13) & 0x07;
    let size = SPRM_OPERAND_SIZES[spra] ?? 0;
    if (size < 0) size = u8(grpprl, offset) + 1;
    if (size > grpprl.length - offset) return;
    const key = PAGE_SPRMS[sprm];
    if (key) {
      const value = i16(grpprl, offset);
      // Word occasionally emits the Word 6/95 variant with negative or absurd
      // page sizes; keep the field only when the value is usable.
      if (value > 0 || key === 'gutter') target[key] = value;
    }
    offset += size;
  }
}

/**
 * Parses every section in the document. Only the first section's geometry is
 * used for layout today; the rest is retained for callers that paginate.
 */
export function parseSections(
  wordBytes: Uint8Array,
  tableBytes: Uint8Array,
  fibRgFcLcb: FibRgFcLcb,
): MsDocSection[] {
  const fc = fibRgFcLcb.fcPlcfSed as number | undefined;
  const lcb = fibRgFcLcb.lcbPlcfSed as number | undefined;
  if (fc == null || lcb == null || lcb < 4 + SED_SIZE) return [];
  const count = Math.floor((lcb - 4) / (4 + SED_SIZE));
  if (count <= 0 || fc + lcb > tableBytes.length) return [];

  const sections: MsDocSection[] = [];
  for (let index = 0; index < count; index += 1) {
    const cpStart = u32(tableBytes, fc + index * 4);
    const cpEnd = u32(tableBytes, fc + (index + 1) * 4);
    const sedOffset = fc + (count + 1) * 4 + index * SED_SIZE;
    const fcSepx = u32(tableBytes, sedOffset + 2);
    const section: MsDocSection = {
      cpStart,
      cpEnd,
      pageWidth: 0,
      pageHeight: 0,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      gutter: 0,
      headerDistance: 0,
      footerDistance: 0,
    };
    if (fcSepx !== 0xffffffff && fcSepx + 2 <= wordBytes.length) {
      const cb = u16(wordBytes, fcSepx);
      const start = fcSepx + 2;
      const end = Math.min(start + cb, wordBytes.length, start + SEPX_MAX_BYTES);
      if (end > start) applySprms(wordBytes.subarray(start, end), section);
    }
    sections.push(section);
  }
  return sections;
}
