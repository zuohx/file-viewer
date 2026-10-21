import type { FibRgFcLcb, FontsCollection, MsDocListDefinition, MsDocListLevel, MsDocListTable } from '../types.js';

/**
 * MS-DOC list data lives in two table-stream structures:
 *   PlfLst - the list definitions (LSTF + one LVL per level)
 *   PlfLfo - the list-format overrides that map a paragraph's ilfo onto an LSTF
 *
 * Word stores the bullet glyph of a list level as a character from a symbol
 * face (Wingdings/Symbol), so the raw code point is a private-use value such as
 * U+F0B2. Callers must translate it before writing HTML.
 */

const LSTF_SIZE = 28;
const LVLF_SIZE = 28;
const LFO_SIZE = 16;
const MAX_LEVELS = 9;

/** spra -> operand byte length, per MS-DOC 2.6.1. */
const SPRM_OPERAND_SIZES = [1, 1, 2, 4, 2, 2, -1, 3] as const;

function u8(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function i32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) | 0;
}

function i16(bytes: Uint8Array, offset: number): number {
  const value = u16(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

/** Reads the font index (ftc) out of an LVL character-property group. */
function readLevelFontIndex(grpprl: Uint8Array): number | undefined {
  let offset = 0;
  while (offset + 2 <= grpprl.length) {
    const sprm = u16(grpprl, offset);
    offset += 2;
    const spra = (sprm >> 13) & 0x07;
    let size = SPRM_OPERAND_SIZES[spra] ?? 0;
    if (size < 0) {
      // Variable-length operand: the first byte is the payload length.
      size = u8(grpprl, offset) + 1;
    }
    if (size > grpprl.length - offset) return undefined;
    // sprmCRgFtc0 / sprmCRgFtc1 / sprmCRgFtc2 / sprmCFtcBi.
    if (sprm === 0x4a4f || sprm === 0x4a50 || sprm === 0x4a51 || sprm === 0x4a5e) {
      return u16(grpprl, offset);
    }
    offset += size;
  }
  return undefined;
}

/** Reads one of the given sprm codes out of a paragraph-property group. */
function readSprmValue(grpprl: Uint8Array, codes: readonly number[]): number | undefined {
  let offset = 0;
  while (offset + 2 <= grpprl.length) {
    const sprm = u16(grpprl, offset);
    offset += 2;
    const spra = (sprm >> 13) & 0x07;
    let size = SPRM_OPERAND_SIZES[spra] ?? 0;
    if (size < 0) size = u8(grpprl, offset) + 1;
    if (size > grpprl.length - offset) return undefined;
    if (codes.includes(sprm)) return i16(grpprl, offset);
    offset += size;
  }
  return undefined;
}

interface RawLevel {
  startAt: number;
  format: number;
  follow: number;
  space: number;
  indent: number;
  char: string;
  fontIndex?: number;
  leftIndent?: number;
  firstLineIndent?: number;
}

function readLevel(
  table: Uint8Array,
  offset: number,
  end: number,
): { level: RawLevel; next: number } | null {
  if (offset + LVLF_SIZE > end) return null;
  const startAt = u32(table, offset);
  const format = u8(table, offset + 4);
  const follow = u8(table, offset + 15);
  const space = i32(table, offset + 16);
  const indent = i32(table, offset + 20);
  const cbChpx = u8(table, offset + 24);
  const cbPapx = u8(table, offset + 25);
  // nfcNil (255) is a legal "no numbering" level; anything above 23 that is not
  // nil means the offset no longer points at an LVLF.
  if (format > 23 && format !== 255) return null;
  let cursor = offset + LVLF_SIZE;
  if (cursor + cbPapx + cbChpx + 2 > end) return null;
  const grpprlPapx = table.subarray(cursor, cursor + cbPapx);
  cursor += cbPapx;
  const grpprlChpx = table.subarray(cursor, cursor + cbChpx);
  cursor += cbChpx;
  const cch = u16(table, cursor);
  cursor += 2;
  if (cch > 255 || cursor + cch * 2 > end) return null;
  let char = '';
  for (let index = 0; index < cch; index += 1) {
    char += String.fromCharCode(u16(table, cursor + index * 2));
  }
  cursor += cch * 2;
  return {
    level: {
      startAt: startAt === 0xffffffff ? 1 : startAt,
      format: format,
      follow,
      space,
      indent,
      char,
      fontIndex: readLevelFontIndex(grpprlChpx),
      // The level's paragraph properties carry the default indents that a
      // paragraph inherits when its own PAPX does not set them. Both the Word 97
      // and the Word 6/95 sprm spellings appear in real files.
      leftIndent: readSprmValue(grpprlPapx, [0x840f, 0x845e]),
      firstLineIndent: readSprmValue(grpprlPapx, [0x8411, 0x8460]),
    },
    next: cursor,
  };
}

interface RawListDefinition {
  id: number;
  simple: boolean;
  levels: RawLevel[];
}

function readListDefinitions(
  table: Uint8Array,
  fcLst: number,
  lcbLst: number,
  hardEnd: number,
): RawListDefinition[] {
  if (fcLst < 0 || fcLst + 2 > table.length) return [];
  const count = Math.min(i16(table, fcLst), 0x7fff);
  if (count <= 0) return [];
  const listfStart = fcLst + 2;
  const levelsStart = listfStart + count * LSTF_SIZE;
  if (levelsStart > table.length) return [];

  const definitions: RawListDefinition[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = listfStart + index * LSTF_SIZE;
    definitions.push({
      id: u32(table, base),
      simple: Boolean(u8(table, base + 26) & 0x01),
      levels: [],
    });
  }

  // The declared lcb normally spans the LVL array. Some producers (WPS) write
  // only the LSTF array into lcb while still appending every LVL, so fall back
  // to the next known table-stream structure as the hard boundary.
  const declaredEnd = fcLst + Math.max(lcbLst, 0);
  const end = Math.max(Math.min(hardEnd, table.length), levelsStart);
  let cursor = levelsStart;
  for (const definition of definitions) {
    const levelCount = definition.simple ? 1 : MAX_LEVELS;
    for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
      const parsed = readLevel(table, cursor, end);
      if (!parsed) {
        // Outside the declared range there may be no LVL data at all.
        if (cursor >= declaredEnd) break;
        return definitions;
      }
      definition.levels.push(parsed.level);
      cursor = parsed.next;
    }
  }
  return definitions;
}

function nextStructureStart(tableBytes: Uint8Array, fibRgFcLcb: FibRgFcLcb, after: number): number {
  let best = tableBytes.length;
  for (const pair of fibRgFcLcb._pairs || []) {
    if (!pair.lcb) continue;
    const start = pair.fc;
    if (start > after && start < best) best = start;
  }
  return best;
}

/** Resolves the ilfo (1-based) -> LSTF (lsid) mapping from PlfLfo. */
function readListOverrides(table: Uint8Array, fcLfo: number, lcbLfo: number): number[] {
  if (fcLfo < 0 || lcbLfo < 4 || fcLfo + 4 > table.length) return [];
  const macros = Math.min(u32(table, fcLfo), 0xffff);
  const ids: number[] = [];
  for (let index = 0; index < macros; index += 1) {
    const offset = fcLfo + 4 + index * LFO_SIZE;
    if (offset + LFO_SIZE > table.length) break;
    ids.push(u32(table, offset));
  }
  return ids;
}

function resolveLevelFont(level: RawLevel, fonts: FontsCollection): string | undefined {
  if (level.fontIndex == null) return undefined;
  return fonts.byIndex(level.fontIndex)?.name || undefined;
}

/**
 * Parses every list definition the document declares and exposes them keyed by
 * ilfo, which is what a paragraph's sprmPIlfo points at.
 */
export function parseLists(
  tableBytes: Uint8Array,
  fibRgFcLcb: FibRgFcLcb,
  fonts: FontsCollection,
  warnings: Array<{ message: string; [key: string]: unknown }> = [],
): MsDocListTable {
  const fcLst = fibRgFcLcb.fcPlfLst as number | undefined;
  const lcbLst = fibRgFcLcb.lcbPlfLst as number | undefined;
  if (fcLst == null || lcbLst == null || lcbLst <= 0) return {};

  const hardEnd = nextStructureStart(tableBytes, fibRgFcLcb, fcLst + Math.max(lcbLst, 0));
  const rawDefinitions = readListDefinitions(tableBytes, fcLst, lcbLst, hardEnd)
    .filter(definition => definition.levels.length > 0);
  if (!rawDefinitions.length) return {};

  const byId = new Map<number, RawListDefinition>();
  for (const definition of rawDefinitions) {
    if (!byId.has(definition.id)) byId.set(definition.id, definition);
  }
  const isUsable = (definition: RawListDefinition) => definition.levels.some(level => (
    level.format === 23 || level.char.length > 0
  ));

  const toDefinition = (definition: RawListDefinition): MsDocListDefinition => ({
    id: definition.id,
    levels: definition.levels.map((level): MsDocListLevel => ({
      startAt: level.startAt,
      format: level.format,
      follow: level.follow,
      space: level.space,
      indent: level.indent,
      char: level.char,
      font: resolveLevelFont(level, fonts),
      leftIndent: level.leftIndent,
      firstLineIndent: level.firstLineIndent,
    })),
  });

  const table: MsDocListTable = {};
  const fcLfo = fibRgFcLcb.fcPlfLfo as number | undefined;
  const lcbLfo = fibRgFcLcb.lcbPlfLfo as number | undefined;
  const overrides = fcLfo != null && lcbLfo != null ? readListOverrides(tableBytes, fcLfo, lcbLfo) : [];

  overrides.forEach((lsid, index) => {
    const definition = byId.get(lsid);
    if (definition && isUsable(definition)) table[String(index + 1)] = toDefinition(definition);
  });

  // Some producers (observed with WPS-saved files) leave the LFO entry empty
  // while paragraphs still point at it. When exactly one usable definition is
  // declared, reuse it instead of dropping every bullet.
  const usable = [...byId.values()].filter(isUsable);
  if (!Object.keys(table).length && usable.length === 1) {
    const only = usable[0]!;
    table['1'] = toDefinition(only);
    warnings.push({
      message: 'List references did not resolve to a declared list; reused the only usable definition.',
      code: 'MSDOC_LIST_SINGLE_DEFINITION_FALLBACK',
    });
  }

  return table;
}
