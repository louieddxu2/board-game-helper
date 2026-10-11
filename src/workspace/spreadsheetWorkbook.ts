import { finishWorkspaceSteps, runWorkspaceCooperativeSteps } from './workspaceCooperativeWork';

export interface SpreadsheetSheet {
  name: string;
  /** Replayable rows let width measurement and XML generation share the same snapshot. */
  rows: unknown[][] | (() => Iterable<unknown[]>);
}
export interface SpreadsheetZipFile { name: string; content: Uint8Array | readonly Uint8Array[] }
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const textChunkSize = 16 * 1024;
const byteChunkSize = 64 * 1024;
const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const columnName = (index: number) => {
  let result = '';
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) result = String.fromCharCode(65 + (current - 1) % 26) + result;
  return result;
};
const truncateSheetName = (name: string, length: number) => {
  const result = name.slice(0, length);
  const last = result.charCodeAt(result.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? result.slice(0, -1) : result;
};
export const safeSheetName = (name: string, used: Set<string>) => {
  const base = truncateSheetName(name.replace(/[\\/*?:\[\]]/g, ' ').trim(), 31) || '表格';
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${truncateSheetName(base, 31 - String(suffix).length - 1)}-${suffix}`;
  used.add(candidate);
  return candidate;
};
const rowsOf = (sheet: SpreadsheetSheet) => typeof sheet.rows === 'function' ? sheet.rows() : sheet.rows;

function* textWidth(value: unknown): Generator<void, number> {
  const text = String(value ?? '');
  let longest = 0, line = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') { longest = Math.max(longest, line); line = 0; }
    else if (text[index] !== '\r' || text[index + 1] !== '\n') line += 1;
    if (line >= 40) return 40;
    if ((index + 1) % textChunkSize === 0) yield;
  }
  return Math.max(longest, line);
}
function* measureSheet(sheet: SpreadsheetSheet) {
  const widths: number[] = [];
  let rowCount = 0;
  for (const row of rowsOf(sheet)) {
    for (let column = 0; column < row.length; column += 1) {
      if ((widths[column] ?? 0) < 40) widths[column] = Math.max(widths[column] ?? 0, yield* textWidth(row[column]));
      if ((column + 1) % 32 === 0) yield;
    }
    rowCount += 1;
    yield;
  }
  return { widths: Array.from({ length: Math.max(1, widths.length) }, (_, index) => Math.max(8, Math.min(42, (widths[index] ?? 0) + 2))), rowCount: Math.max(1, rowCount) };
}

/** Encode bounded fragments instead of retaining and encoding one entire XML string. */
function* sheetBytes(sheet: SpreadsheetSheet): Generator<void, Uint8Array[]> {
  const { widths, rowCount } = yield* measureSheet(sheet);
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let buffer = '';
  function* append(text: string): Generator<void> {
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + textChunkSize - buffer.length);
      // Do not encode half of a UTF-16 surrogate pair at a fragment boundary.
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1;
      if (end === offset) {
        parts.push(encoder.encode(buffer)); buffer = '';
        continue;
      }
      buffer += text.slice(offset, end); offset = end;
      if (buffer.length >= textChunkSize - 1) { parts.push(encoder.encode(buffer)); buffer = ''; yield; }
    }
  }
  yield* append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(widths.length - 1)}${rowCount}"/><cols>`);
  for (let index = 0; index < widths.length; index += 1) yield* append(`<col min="${index + 1}" max="${index + 1}" width="${widths[index]}" customWidth="1"/>`);
  yield* append('</cols><sheetData>');
  let rowNumber = 0;
  for (const row of rowsOf(sheet)) {
    rowNumber += 1;
    yield* append(`<row r="${rowNumber}">`);
    for (let column = 0; column < row.length; column += 1) {
      const value = row[column];
      if (value === null || value === undefined || value === '') continue;
      const reference = `${columnName(column)}${rowNumber}`;
      if (typeof value === 'number' && Number.isFinite(value)) yield* append(`<c r="${reference}"><v>${value}</v></c>`);
      else {
        yield* append(`<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">`);
        const text = String(value);
        for (let offset = 0; offset < text.length;) {
          let end = Math.min(text.length, offset + textChunkSize);
          if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1;
          yield* append(escapeXml(text.slice(offset, end))); offset = end;
          yield;
        }
        yield* append('</t></is></c>');
      }
      if ((column + 1) % 32 === 0) yield;
    }
    yield* append('</row>');
    yield;
  }
  yield* append('</sheetData></worksheet>');
  if (buffer) parts.push(encoder.encode(buffer));
  return parts;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const write16 = (target: Uint8Array, offset: number, value: number) => { target[offset] = value & 0xff; target[offset + 1] = value >>> 8 & 0xff; };
const write32 = (target: Uint8Array, offset: number, value: number) => {
  for (let byte = 0; byte < 4; byte += 1) target[offset + byte] = value >>> byte * 8 & 0xff;
};

export function* zipStoreBytesSteps(files: readonly SpreadsheetZipFile[], mimeType = xlsxMimeType): Generator<void, Blob> {
  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [], centralParts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    let checksum = 0xffffffff, size = 0;
    const content: Blob[] = [];
    for (const part of ArrayBuffer.isView(file.content) ? [file.content] : file.content) {
      for (let start = 0; start < part.length; start += byteChunkSize) {
        const chunk = part.subarray(start, start + byteChunkSize);
        for (let index = 0; index < chunk.length; index += 1) checksum = crcTable[(checksum ^ chunk[index]) & 0xff] ^ (checksum >>> 8);
        // Small immutable Blobs make final concatenation reuse data rather than copy it all.
        const bytes = chunk.buffer instanceof ArrayBuffer ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : chunk.slice();
        content.push(new Blob([bytes])); size += chunk.length;
        yield;
      }
    }
    checksum = (checksum ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length);
    write32(header, 0, 0x04034b50); write16(header, 4, 20); write16(header, 6, 0x0800);
    write32(header, 14, checksum); write32(header, 18, size); write32(header, 22, size); write16(header, 26, name.length); header.set(name, 30);
    localParts.push(header, ...content);
    const central = new Uint8Array(46 + name.length);
    write32(central, 0, 0x02014b50); write16(central, 4, 20); write16(central, 6, 20); write16(central, 8, 0x0800);
    write32(central, 16, checksum); write32(central, 20, size); write32(central, 24, size); write16(central, 28, name.length); write32(central, 42, offset); central.set(name, 46);
    centralParts.push(central); offset += header.length + size;
    yield;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  write32(end, 0, 0x06054b50); write16(end, 8, files.length); write16(end, 10, files.length); write32(end, 12, centralSize); write32(end, 16, offset);
  return new Blob([...localParts, ...centralParts, end], { type: mimeType });
}
export const zipStoreBytes = (files: readonly SpreadsheetZipFile[], mimeType?: string) => finishWorkspaceSteps(zipStoreBytesSteps(files, mimeType));
export const zipStoreBytesAsync = (files: readonly SpreadsheetZipFile[], mimeType?: string, checkCurrent: () => void = () => undefined) => runWorkspaceCooperativeSteps(zipStoreBytesSteps(files, mimeType), checkCurrent);

export function* workbookFromRowsSteps(sheets: readonly SpreadsheetSheet[]): Generator<void, Blob> {
  const files: SpreadsheetZipFile[] = [], names: string[] = [];
  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    names.push(safeSheetName(sheet.name, usedNames));
    files.push({ name: `xl/worksheets/sheet${files.length + 1}.xml`, content: yield* sheetBytes(sheet) });
  }
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`;
  const encoder = new TextEncoder();
  for (const [name, text] of [
    ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', relationships],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['[Content_Types].xml', contentTypes],
  ]) files.push({ name, content: encoder.encode(text) });
  return yield* zipStoreBytesSteps(files);
}
export const workbookFromRows = (sheets: readonly SpreadsheetSheet[]) => finishWorkspaceSteps(workbookFromRowsSteps(sheets));
