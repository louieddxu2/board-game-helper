import type { CellValue, Sheet } from 'read-excel-file/browser';
import { getRowHeaderColumn, isWorkspaceLinkValue } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceLinkValue, WorkspaceNode, WorkspaceRow, WorkspaceTable } from './types';
import { WORKSPACE_FORMAT } from './types';

export const blobBytes = async (blob: Blob) => new Uint8Array(await (typeof blob.arrayBuffer === 'function'
  ? blob.arrayBuffer()
  : new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('無法讀取備份內容'));
    reader.readAsArrayBuffer(blob);
  })));

export type SheetCell = CellValue<number> | null;

export type SheetRows = SheetCell[][];

export const readXlsxFile = async (file: File | Blob) => (await import('read-excel-file/browser')).default(file);

export const TABLE_SETTINGS_MARKER = '__workspace_table_settings';

export const WORKSPACE_MARKER = '__workspace';

export const BACKUP_MANIFEST_MARKER = '__workspace_backup_manifest';

export const CURRENT_XLSX_FORMAT_VERSION = 1;

export const WORKSPACE_ARCHIVE_ROOT = 'BoardGameHelper/動態表格備份';

export const WORKSPACE_ARCHIVE_FILE_NAME = 'BoardGameHelper-動態表格備份.zip';

export const OPTIONS_JSON_MARKER = '__workspace_options_json:';

export const OPTION_COLORS_JSON_MARKER = '__workspace_option_colors_json:';

export const NUMBER_RANGES_JSON_MARKER = '__workspace_number_ranges_json:';

export const INPUT_TYPES: WorkspaceInputType[] = ['text', 'number', 'select', 'dynamic-select', 'link', 'datetime'];

type AssertNever<T extends never> = T;

type SerializedColumnFields = 'id' | 'name' | 'inputType' | 'numberInputMode' | 'options' | 'optionColors' | 'numberRanges' | 'hidden' | 'isMultiple' | 'alignment' | 'overflowMode' | 'widthLimitChars' | 'lineLimit' | 'dateOnly';

type IntentionallyRegeneratedColumnFields = 'dynamicOptions';

type SerializedTableFields = 'id' | 'changeRevision' | 'name' | 'rowHeaderName' | 'rowHeader' | 'textScale' | 'transposed' | 'columns' | 'rows';

type IntentionallyRegeneratedTableFields = 'updatedAt';

type SerializedNodeFields = 'id' | 'type' | 'name' | 'parentId' | 'order' | 'tableId';

type SerializedRowFields = 'id' | 'name' | 'values';

type SerializedWorkspaceFields = 'version' | 'structureRevision' | 'updatedAt' | 'nodes' | 'tables' | 'activeNodeId' | 'bottomNavigationTableIds';

type SupportedCellValue = string | number | WorkspaceLinkValue | null;

export type WorkspaceXlsxSchemaCoverage = [
  AssertNever<Exclude<keyof WorkspaceColumn, SerializedColumnFields | IntentionallyRegeneratedColumnFields>>,
  AssertNever<Exclude<keyof WorkspaceTable, SerializedTableFields | IntentionallyRegeneratedTableFields>>,
  AssertNever<Exclude<keyof WorkspaceNode, SerializedNodeFields>>,
  AssertNever<Exclude<keyof WorkspaceRow, SerializedRowFields>>,
  AssertNever<Exclude<keyof WorkspaceData, SerializedWorkspaceFields>>,
  AssertNever<Exclude<WorkspaceCellValue, SupportedCellValue>>,
];

const serializeDataCellValue = (value: WorkspaceCellValue) => isWorkspaceLinkValue(value)
  ? value.label.trim() ? `${value.label.trim()}\n${value.url}` : value.url
  : value;

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const columnName = (index: number) => {
  let result = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
};

const xmlCell = (row: number, column: number, value: unknown) => {
  if (value === null || value === undefined || value === '') return '';
  const reference = `${columnName(column)}${row}`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
  const text = String(value);
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
};

const sheetXml = (rows: unknown[][]) => {
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const maxRows = Math.max(1, rows.length);
  const widths = Array.from({ length: maxColumns }, (_, columnIndex) => {
    const contentWidth = Math.max(0, ...rows.map((row) => String(row[columnIndex] ?? '').split(/\r?\n/).reduce((longest, line) => Math.max(longest, line.length), 0)));
    return Math.max(8, Math.min(42, contentWidth + 2));
  });
  const columns = `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`;
  const cells = rows.map((row, rowIndex) => {
    const values = row.map((value, columnIndex) => xmlCell(rowIndex + 1, columnIndex, value)).join('');
    return `<row r="${rowIndex + 1}">${values}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(maxColumns - 1)}${maxRows}"/>${columns}<sheetData>${cells}</sheetData></worksheet>`;
};

const serializeColumnSettings = (kind: 'row_header' | 'column', column: WorkspaceColumn) => [
  kind,
  column.id,
  column.name,
  column.inputType,
  `${OPTIONS_JSON_MARKER}${JSON.stringify(column.options)}`,
  column.alignment ?? 'left',
  column.overflowMode ?? (kind === 'row_header' ? 'expand' : column.inputType === 'link' ? 'ellipsis' : 'wrap'),
  `${OPTION_COLORS_JSON_MARKER}${JSON.stringify(column.optionColors ?? {})}`,
  `${NUMBER_RANGES_JSON_MARKER}${JSON.stringify(column.numberRanges ?? [])}`,
  kind === 'column' && column.hidden ? 'true' : 'false',
  column.isMultiple ? 'true' : 'false',
  column.widthLimitChars ?? '',
  column.dateOnly ? 'true' : 'false',
  column.lineLimit ?? '',
  column.numberInputMode ?? '',
];

export const tableSettingsRows = (table: WorkspaceTable, dataSheetName: string): unknown[][] => {
  const rowHeader = getRowHeaderColumn(table);
  return [
  [TABLE_SETTINGS_MARKER, CURRENT_XLSX_FORMAT_VERSION],
  ['data_sheet', dataSheetName],
  ['table_id', table.id],
  ['change_revision', table.changeRevision ?? ''],
  ['table_name', table.name],
  ['row_header_name', rowHeader.name],
  ['text_scale', table.textScale ?? 1],
  ['transposed_view', table.transposed ? 'true' : 'false'],
  serializeColumnSettings('row_header', rowHeader),
  ['columns', 'id', 'name', 'inputType', 'options', 'alignment', 'overflowMode', 'optionColors', 'numberRanges', 'hidden', 'isMultiple', 'widthLimitChars', 'dateOnly', 'lineLimit', 'numberInputMode'],
  ...table.columns.map((column) => serializeColumnSettings('column', column)),
  ];
};

export const tableDataRows = (table: WorkspaceTable): unknown[][] => {
  const rowHeader = getRowHeaderColumn(table);
  return [
    [rowHeader.name, ...table.columns.map((column) => column.name)],
    ...table.rows.map((row) => [serializeDataCellValue(row.name), ...table.columns.map((column) => serializeDataCellValue(row.values[column.id] ?? null))]),
  ];
};

export const workspaceRows = (data: WorkspaceData): unknown[][] => [
  [WORKSPACE_MARKER, CURRENT_XLSX_FORMAT_VERSION],
  ['format', WORKSPACE_FORMAT],
  ['active_node_id', data.activeNodeId ?? ''],
  ['structure_revision', data.structureRevision ?? ''],
  ['bottom_navigation_table_ids', ...(data.bottomNavigationTableIds ?? [])],
  ['nodes', 'id', 'type', 'name', 'parentId', 'order', 'tableId'],
  ...data.nodes.map((node) => ['node', node.id, node.type, node.name, node.parentId ?? '', node.order, node.tableId ?? '']),
];

const contentTypesXml = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;

const workbookXml = (names: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;

const workbookRelsXml = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`;

const rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const writeUint16 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
};

const writeUint32 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
};

export const zipStoreBytes = (files: Array<{ name: string; content: Uint8Array }>, mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') => {
  const encoder = new TextEncoder();
  const entries = files.map((file) => ({ name: encoder.encode(file.name), content: file.content }));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const header = new Uint8Array(30 + entry.name.length);
    writeUint32(header, 0, 0x04034b50); writeUint16(header, 4, 20); writeUint16(header, 6, 0x0800); writeUint16(header, 8, 0);
    writeUint16(header, 10, 0); writeUint16(header, 12, 0); writeUint32(header, 14, crc32(entry.content));
    writeUint32(header, 18, entry.content.length); writeUint32(header, 22, entry.content.length); writeUint16(header, 26, entry.name.length); writeUint16(header, 28, 0); header.set(entry.name, 30);
    localParts.push(header, entry.content);

    const central = new Uint8Array(46 + entry.name.length);
    writeUint32(central, 0, 0x02014b50); writeUint16(central, 4, 20); writeUint16(central, 6, 20); writeUint16(central, 8, 0x0800); writeUint16(central, 10, 0);
    writeUint16(central, 12, 0); writeUint16(central, 14, 0); writeUint32(central, 16, crc32(entry.content)); writeUint32(central, 20, entry.content.length); writeUint32(central, 24, entry.content.length);
    writeUint16(central, 28, entry.name.length); writeUint16(central, 30, 0); writeUint16(central, 32, 0); writeUint16(central, 34, 0); writeUint16(central, 36, 0); writeUint32(central, 38, 0); writeUint32(central, 42, offset); central.set(entry.name, 46);
    centralParts.push(central);
    offset += header.length + entry.content.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50); writeUint16(end, 8, entries.length); writeUint16(end, 10, entries.length); writeUint32(end, 12, centralSize); writeUint32(end, 16, offset);
  const parts = [...localParts, ...centralParts, end];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) { bytes.set(part, position); position += part.length; }
  return new Blob([bytes.buffer], { type: mimeType });
};

const zipStore = (files: Array<{ name: string; content: string }>) => zipStoreBytes(files.map((file) => ({ name: file.name, content: new TextEncoder().encode(file.content) })));

export const safeSheetName = (name: string, used: Set<string>) => {
  const base = name.replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || '表格';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base.slice(0, 31 - String(suffix).length - 1)}-${suffix++}`;
  used.add(candidate);
  return candidate;
};

export const workbookFromRows = (sheets: Array<{ name: string; rows: unknown[][] }>) => {
  const files: Array<{ name: string; content: string }> = [];
  const names: string[] = [];
  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    const sheetName = safeSheetName(sheet.name, usedNames);
    names.push(sheetName);
    files.push({ name: `xl/worksheets/sheet${files.length + 1}.xml`, content: sheetXml(sheet.rows) });
  }
  const sheetCount = names.length;
  files.push({ name: 'xl/workbook.xml', content: workbookXml(names) });
  files.push({ name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml(sheetCount) });
  files.push({ name: '_rels/.rels', content: rootRelsXml });
  files.push({ name: '[Content_Types].xml', content: contentTypesXml(sheetCount) });
  return zipStore(files);
};

const readUint16 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8);

const readUint32 = (bytes: Uint8Array, offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

export const readStoredXlsx = async (file: Blob): Promise<Array<Sheet<number>>> => {
  const bytes = await blobBytes(file);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= bytes.length && readUint32(bytes, offset) === 0x04034b50) {
    const method = readUint16(bytes, offset + 8);
    if (method !== 0) throw new Error('需要使用 Excel reader 解析壓縮工作簿');
    const size = readUint32(bytes, offset + 18);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const contentStart = offset + 30 + nameLength + extraLength;
    entries.set(name, decoder.decode(bytes.subarray(contentStart, contentStart + size)));
    offset = contentStart + size;
  }
  const workbookXml = entries.get('xl/workbook.xml');
  if (!workbookXml) throw new Error('不是有效的 XLSX 工作簿');
  const document = new DOMParser().parseFromString(workbookXml, 'application/xml');
  const sheetElements = Array.from(document.getElementsByTagName('sheet'));
  return sheetElements.map((sheetElement, index) => {
    const name = sheetElement.getAttribute('name') ?? `Sheet${index + 1}`;
    const xml = entries.get(`xl/worksheets/sheet${index + 1}.xml`);
    if (!xml) throw new Error(`找不到工作表：${name}`);
    const sheetDocument = new DOMParser().parseFromString(xml, 'application/xml');
    const rows: SheetRows = [];
    for (const rowElement of Array.from(sheetDocument.getElementsByTagName('row'))) {
      const row: SheetCell[] = [];
      for (const cellElement of Array.from(rowElement.getElementsByTagName('c'))) {
        const ref = cellElement.getAttribute('r') ?? 'A1';
        const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
        let column = 0;
        for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
        const type = cellElement.getAttribute('t');
        const value = type === 'inlineStr'
          ? cellElement.getElementsByTagName('t')[0]?.textContent ?? ''
          : cellElement.getElementsByTagName('v')[0]?.textContent ?? '';
        row[column - 1] = type === 'inlineStr' ? value : value === '' ? null : Number(value);
      }
      rows.push(row);
    }
    return { sheet: name, data: rows };
  });
};

export const readStoredZip = async (file: Blob) => {
  const bytes = await blobBytes(file);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  let entryCount = 0;
  while (offset + 4 <= bytes.length && readUint32(bytes, offset) === 0x04034b50) {
    const flags = readUint16(bytes, offset + 6);
    const method = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (flags & 0x0008) throw new Error('備份 ZIP 使用不支援的資料描述格式');
    if (method !== 0) throw new Error('備份 ZIP 必須使用標準試算表封裝格式');
    if (!name || name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('備份 ZIP 的檔案路徑不安全');
    if (contentStart + compressedSize > bytes.length) throw new Error('備份 ZIP 內容不完整');
    if (!name.endsWith('/')) entries.set(name, bytes.slice(contentStart, contentStart + compressedSize));
    offset = contentStart + compressedSize;
    entryCount += 1;
  }
  if (!entryCount || !entries.size) throw new Error('不是有效的 Workspace ZIP 備份');
  return entries;
};
