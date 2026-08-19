import readXlsxFile, { type CellValue, type Sheet } from 'read-excel-file/browser';
import { createColumn, createNode, createRow, createTable, getRowHeaderColumn, isWorkspaceColor, isWorkspaceLinkValue, isWorkspaceUrlText, makeId, normalizeWorkspaceDateTime } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceLinkValue, WorkspaceNode, WorkspaceNumberInputMode, WorkspaceNumberRange, WorkspaceOverflowMode, WorkspaceRow, WorkspaceTable, WorkspaceTextAlign } from './types';
import { WORKSPACE_FORMAT } from './types';

const TABLE_SETTINGS_MARKER = '__workspace_table_settings';
const WORKSPACE_MARKER = '__workspace';
const BACKUP_MANIFEST_MARKER = '__workspace_backup_manifest';
const CURRENT_XLSX_FORMAT_VERSION = 1;
const OPTIONS_JSON_MARKER = '__workspace_options_json:';
const OPTION_COLORS_JSON_MARKER = '__workspace_option_colors_json:';
const NUMBER_RANGES_JSON_MARKER = '__workspace_number_ranges_json:';
const INPUT_TYPES: WorkspaceInputType[] = ['text', 'number', 'select', 'dynamic-select', 'link', 'datetime'];

type AssertNever<T extends never> = T;
type SerializedColumnFields = 'id' | 'name' | 'inputType' | 'numberInputMode' | 'options' | 'optionColors' | 'numberRanges' | 'hidden' | 'isMultiple' | 'alignment' | 'overflowMode' | 'widthLimitChars' | 'lineLimit' | 'dateOnly';
type SerializedTableFields = 'id' | 'name' | 'rowHeaderName' | 'rowHeader' | 'textScale' | 'transposed' | 'columns' | 'rows';
type IntentionallyRegeneratedTableFields = 'updatedAt';
type SerializedNodeFields = 'id' | 'type' | 'name' | 'parentId' | 'order' | 'tableId';
type SerializedRowFields = 'id' | 'name' | 'values';
type SerializedWorkspaceFields = 'version' | 'updatedAt' | 'nodes' | 'tables' | 'activeNodeId';
type SupportedCellValue = string | number | WorkspaceLinkValue | null;
export type WorkspaceXlsxSchemaCoverage = [
  AssertNever<Exclude<keyof WorkspaceColumn, SerializedColumnFields>>,
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

const tableSettingsRows = (table: WorkspaceTable, dataSheetName: string): unknown[][] => {
  const rowHeader = getRowHeaderColumn(table);
  return [
  [TABLE_SETTINGS_MARKER, CURRENT_XLSX_FORMAT_VERSION],
  ['data_sheet', dataSheetName],
  ['table_id', table.id],
  ['table_name', table.name],
  ['row_header_name', rowHeader.name],
  ['text_scale', table.textScale ?? 1],
  ['transposed_view', table.transposed ? 'true' : 'false'],
  serializeColumnSettings('row_header', rowHeader),
  ['columns', 'id', 'name', 'inputType', 'options', 'alignment', 'overflowMode', 'optionColors', 'numberRanges', 'hidden', 'isMultiple', 'widthLimitChars', 'dateOnly', 'lineLimit', 'numberInputMode'],
  ...table.columns.map((column) => serializeColumnSettings('column', column)),
  ];
};

const tableDataRows = (table: WorkspaceTable): unknown[][] => {
  const rowHeader = getRowHeaderColumn(table);
  return [
    [rowHeader.name, ...table.columns.map((column) => column.name)],
    ...table.rows.map((row) => [serializeDataCellValue(row.name), ...table.columns.map((column) => serializeDataCellValue(row.values[column.id] ?? null))]),
  ];
};

const workspaceRows = (data: WorkspaceData): unknown[][] => [
  [WORKSPACE_MARKER, CURRENT_XLSX_FORMAT_VERSION],
  ['format', WORKSPACE_FORMAT],
  ['active_node_id', data.activeNodeId ?? ''],
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

const zipStore = (files: Array<{ name: string; content: string }>) => {
  const encoder = new TextEncoder();
  const entries = files.map((file) => ({ name: encoder.encode(file.name), content: encoder.encode(file.content) }));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const header = new Uint8Array(30 + entry.name.length);
    writeUint32(header, 0, 0x04034b50); writeUint16(header, 4, 20); writeUint16(header, 6, 0); writeUint16(header, 8, 0);
    writeUint16(header, 10, 0); writeUint16(header, 12, 0); writeUint32(header, 14, crc32(entry.content));
    writeUint32(header, 18, entry.content.length); writeUint32(header, 22, entry.content.length); writeUint16(header, 26, entry.name.length); writeUint16(header, 28, 0); header.set(entry.name, 30);
    localParts.push(header, entry.content);

    const central = new Uint8Array(46 + entry.name.length);
    writeUint32(central, 0, 0x02014b50); writeUint16(central, 4, 20); writeUint16(central, 6, 20); writeUint16(central, 8, 0); writeUint16(central, 10, 0);
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
  return new Blob([bytes.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

const safeSheetName = (name: string, used: Set<string>) => {
  const base = name.replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || '表格';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base.slice(0, 31 - String(suffix).length - 1)}-${suffix++}`;
  used.add(candidate);
  return candidate;
};

const workbookFromRows = (sheets: Array<{ name: string; rows: unknown[][] }>) => {
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

export interface WorkspaceBackupTableFileRef {
  id: string;
  nodeId: string;
  folderId: string | null;
  name: string;
  updatedAt: number;
  driveFileId: string;
  fileName: string;
}

export interface WorkspaceBackupFolderRef {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  driveFolderId: string;
}

export interface ImportedWorkspaceBackupManifest {
  nodes: WorkspaceNode[];
  activeNodeId: string | null;
  sourceUpdatedAt: number;
  folders: WorkspaceBackupFolderRef[];
  tables: WorkspaceBackupTableFileRef[];
}

export const exportWorkspaceBackupManifestXlsx = (data: WorkspaceData, folders: WorkspaceBackupFolderRef[], tables: WorkspaceBackupTableFileRef[], sourceUpdatedAt: number) => workbookFromRows([{
  name: '__workspace',
  rows: [
    [BACKUP_MANIFEST_MARKER, CURRENT_XLSX_FORMAT_VERSION],
    ['format', 'board-game-helper-workspace-backup'],
    ['source_updated_at', sourceUpdatedAt],
    ['active_node_id', data.activeNodeId ?? ''],
    ['nodes', 'id', 'type', 'name', 'parentId', 'order', 'tableId'],
    ...data.nodes.map((node) => ['node', node.id, node.type, node.name, node.parentId ?? '', node.order, node.tableId ?? '']),
    ['folder_files', 'id', 'name', 'parentId', 'order', 'driveFolderId'],
    ...folders.map((folder) => ['folder_file', folder.id, folder.name, folder.parentId ?? '', folder.order, folder.driveFolderId]),
    ['table_files', 'id', 'nodeId', 'folderId', 'name', 'updatedAt', 'driveFileId', 'fileName'],
    ...tables.map((table) => ['table_file', table.id, table.nodeId, table.folderId ?? '', table.name, table.updatedAt, table.driveFileId, table.fileName]),
  ],
}]);

export const exportWorkspaceXlsx = (data: WorkspaceData, table?: WorkspaceTable) => {
  const tables = table ? [table] : data.tables;
  const sheets: Array<{ name: string; rows: unknown[][] }> = [];
  const usedNames = new Set<string>();
  if (!table) {
    sheets.push({ name: safeSheetName('__workspace', usedNames), rows: workspaceRows(data) });
  }
  for (const currentTable of tables) {
    const dataSheetName = safeSheetName(currentTable.name, usedNames);
    const settingsSheetName = safeSheetName(`${dataSheetName}__設定`, usedNames);
    sheets.push({ name: dataSheetName, rows: tableDataRows(currentTable) });
    sheets.push({ name: settingsSheetName, rows: tableSettingsRows(currentTable, dataSheetName) });
  }
  return workbookFromRows(sheets);
};

type SheetCell = CellValue<number> | null;
type SheetRows = SheetCell[][];
const stringValue = (value: SheetCell | undefined) => value === null || value === undefined ? '' : String(value);
const sheetVersion = (rows: SheetRows) => Number(stringValue(rows[0]?.[1]));
const assertSheetVersion = (rows: SheetRows, marker: string, supportedVersion: number) => {
  if (stringValue(rows[0]?.[0]) !== marker) throw new Error(`找不到格式標記：${marker}`);
  const version = sheetVersion(rows);
  if (version !== supportedVersion) throw new Error(`不支援的 ${marker} 格式版本：${stringValue(rows[0]?.[1]) || '未知'}`);
};
const parseType = (value: string): WorkspaceInputType => INPUT_TYPES.includes(value as WorkspaceInputType) ? value as WorkspaceInputType : 'text';
const parseNumberInputMode = (value: string): WorkspaceNumberInputMode | undefined => value === 'input' || value === 'adjust' || value === 'step' ? value : undefined;
const parseAlignment = (value: string): WorkspaceTextAlign => value === 'center' || value === 'right' ? value : 'left';
const parseOverflowMode = (value: string, inputType: WorkspaceInputType, fallback: WorkspaceOverflowMode = 'wrap'): WorkspaceOverflowMode => value === 'expand' || value === 'ellipsis' || value === 'wrap' ? value : inputType === 'link' ? 'ellipsis' : fallback;
const parseOptions = (value: string) => {
  if (value.startsWith(OPTIONS_JSON_MARKER)) {
    try {
      const parsed: unknown = JSON.parse(value.slice(OPTIONS_JSON_MARKER.length));
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed.map((item) => item.trim()).filter(Boolean);
      }
    } catch {
      // Fall through to the legacy line-based format for damaged or hand-edited files.
    }
  }
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
};
const parseOptionColors = (value: string): Record<string, string> => {
  if (!value.startsWith(OPTION_COLORS_JSON_MARKER)) return {};
  try {
    const parsed: unknown = JSON.parse(value.slice(OPTION_COLORS_JSON_MARKER.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([option, color]) => Boolean(option.trim()) && isWorkspaceColor(color)));
  } catch {
    return {};
  }
};
const parseNumberRanges = (value: string): WorkspaceNumberRange[] => {
  if (!value.startsWith(NUMBER_RANGES_JSON_MARKER)) return [];
  try {
    const parsed: unknown = JSON.parse(value.slice(NUMBER_RANGES_JSON_MARKER.length));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<WorkspaceNumberRange>;
      const min = candidate.min === null || candidate.min === undefined ? null : Number(candidate.min);
      const max = candidate.max === null || candidate.max === undefined ? null : Number(candidate.max);
      if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)) || (min !== null && max !== null && min > max) || !isWorkspaceColor(candidate.color)) return [];
      return [{ min, max, color: candidate.color }];
    });
  } catch {
    return [];
  }
};

const parseCellValue = (raw: SheetCell | undefined, column: WorkspaceColumn): WorkspaceCellValue => {
  if (raw === null || raw === undefined || raw === '') return null;
  const text = stringValue(raw);
  if (column.inputType === 'link') {
    const parts = text.split(/\r?\n/);
    const possibleUrl = parts.at(-1)?.trim() ?? '';
    if (parts.length > 1 && /^https?:\/\//i.test(possibleUrl)) return { url: possibleUrl, label: parts.slice(0, -1).join('\n').trim() };
    return { url: text, label: '' };
  }
  if (column.inputType === 'datetime') return normalizeWorkspaceDateTime(raw instanceof Date ? raw.toISOString() : text);
  if (column.inputType === 'number' && typeof raw === 'number') return raw;
  return text || null;
};

const parseColumnSettings = (row: SheetCell[] | undefined, fallbackName: string, fallbackOverflow: WorkspaceOverflowMode): WorkspaceColumn => {
  const column = createColumn(stringValue(row?.[2]) || fallbackName, parseType(stringValue(row?.[3])));
  column.id = stringValue(row?.[1]) || column.id;
  column.options = parseOptions(stringValue(row?.[4]));
  column.alignment = parseAlignment(stringValue(row?.[5]));
  column.overflowMode = parseOverflowMode(stringValue(row?.[6]), column.inputType, fallbackOverflow);
  column.optionColors = parseOptionColors(stringValue(row?.[7]));
  column.numberRanges = parseNumberRanges(stringValue(row?.[8]));
  column.hidden = stringValue(row?.[9]) === 'true';
  column.isMultiple = stringValue(row?.[10]) === 'true';
  const widthLimitChars = Number(row?.[11]);
  column.widthLimitChars = Number.isFinite(widthLimitChars) && widthLimitChars > 0 ? Math.max(1, Math.round(widthLimitChars)) : undefined;
  column.dateOnly = stringValue(row?.[12]) === 'true';
  const lineLimit = Number(row?.[13]);
  column.lineLimit = Number.isFinite(lineLimit) && lineLimit > 0 ? Math.max(1, Math.round(lineLimit)) : undefined;
  column.numberInputMode = parseNumberInputMode(stringValue(row?.[14]));
  return column;
};

const parseSeparatedTable = (settingsRows: SheetRows, dataRows: SheetRows): WorkspaceTable => {
  assertSheetVersion(settingsRows, TABLE_SETTINGS_MARKER, CURRENT_XLSX_FORMAT_VERSION);
  const tableId = stringValue(settingsRows.find((row) => stringValue(row[0]) === 'table_id')?.[1]) || makeId('table');
  const tableName = stringValue(settingsRows.find((row) => stringValue(row[0]) === 'table_name')?.[1]) || '匯入表格';
  const textScaleValue = Number(settingsRows.find((row) => stringValue(row[0]) === 'text_scale')?.[1]);
  const textScale = Number.isFinite(textScaleValue) ? Math.max(0.1, Math.min(2.5, textScaleValue)) : 1;
  const transposed = stringValue(settingsRows.find((row) => stringValue(row[0]) === 'transposed_view')?.[1]) === 'true';
  const rowHeaderMetadata = settingsRows.find((row) => stringValue(row[0]) === 'row_header');
  const rowHeader = parseColumnSettings(rowHeaderMetadata, stringValue(dataRows[0]?.[0]) || '物件', 'expand');
  rowHeader.hidden = false;
  const columns = settingsRows.filter((row) => stringValue(row[0]) === 'column').map((row) => parseColumnSettings(row, '未命名屬性', 'wrap'));
  if (!columns.length) throw new Error('匯入表格沒有欄位設定');
  const expectedHeaders = [rowHeader.name, ...columns.map((column) => column.name)];
  const actualHeaders = (dataRows[0] ?? []).slice(0, expectedHeaders.length).map((cell) => stringValue(cell));
  if (actualHeaders.length !== expectedHeaders.length || actualHeaders.some((header, index) => header !== expectedHeaders[index])) throw new Error('資料頁欄位與設定頁不一致，請勿重新命名或重新排列欄位');
  const rows = dataRows.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== '')).map((row) => ({
    id: makeId('row'),
    name: parseCellValue(row[0], rowHeader) ?? '',
    values: Object.fromEntries(columns.map((column, index) => [column.id, parseCellValue(row[index + 1], column)])),
  }));
  return { id: tableId, name: tableName, rowHeaderName: rowHeader.name, rowHeader, textScale, transposed, columns, rows, updatedAt: Date.now() };
};

const uniqueColumnName = (candidate: string, used: Set<string>) => {
  const base = candidate.trim();
  if (!base) return '';
  let name = base;
  let suffix = 2;
  while (used.has(name)) name = `${base} ${suffix++}`;
  used.add(name);
  return name;
};

export const inferPlainColumnSettings = (values: unknown[]): Pick<WorkspaceColumn, 'inputType' | 'options' | 'overflowMode' | 'dateOnly'> => {
  const populated = values.filter((value) => value !== null && value !== undefined && value !== '');
  if (!populated.length) return { inputType: 'text', options: [], overflowMode: 'wrap' };
  if (populated.every((value) => typeof value === 'number' && Number.isFinite(value))) return { inputType: 'number', options: [], overflowMode: 'wrap' };
  if (populated.every((value) => typeof value === 'string' && isWorkspaceUrlText(value))) return { inputType: 'link', options: [], overflowMode: 'ellipsis' };
  const dateLike = (value: unknown) => value instanceof Date || (typeof value === 'string' && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(value.trim()) && Boolean(normalizeWorkspaceDateTime(value)));
  const dateOnlyLike = (value: unknown) => value instanceof Date
    ? value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0
    : typeof value === 'string' && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(value.trim());
  if (populated.every(dateLike)) return { inputType: 'datetime', options: [], overflowMode: 'wrap', dateOnly: populated.every(dateOnlyLike) };
  if (populated.every((value) => typeof value === 'string')) {
    const seen = new Set<string>();
    const options: string[] = [];
    for (const value of populated) {
      const option = String(value).trim();
      const key = option.toLocaleLowerCase();
      if (!option || seen.has(key)) continue;
      seen.add(key);
      options.push(option);
      if (options.length > 10) return { inputType: 'text', options: [], overflowMode: 'wrap' };
    }
    if (options.length < populated.length) return { inputType: 'select', options, overflowMode: 'wrap' };
  }
  return { inputType: 'text', options: [], overflowMode: 'wrap' };
};

const parsePlainTable = (rows: SheetRows, sheetName: string): WorkspaceTable => {
  const header = rows[0] ?? [];
  if (header.length < 2) throw new Error('試算表至少需要項目欄與一個屬性欄');
  const rowHeaderName = stringValue(header[0]);
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== ''));
  const rowHeaderInference = inferPlainColumnSettings(dataRows.map((row) => row[0]));
  const rowHeader = { ...createColumn(rowHeaderName, rowHeaderInference.inputType), ...rowHeaderInference };
  if (rowHeader.inputType === 'text') rowHeader.overflowMode = 'expand';
  const usedNames = new Set<string>();
  const columns = header.slice(1).map((value, columnIndex) => {
    const inference = inferPlainColumnSettings(dataRows.map((row) => row[columnIndex + 1]));
    return { ...createColumn(uniqueColumnName(stringValue(value), usedNames), inference.inputType), ...inference };
  });
  const rowsData: WorkspaceRow[] = dataRows.map((row) => ({
    id: makeId('row'),
    name: parseCellValue(row[0], rowHeader),
    values: Object.fromEntries(columns.map((column, columnIndex) => {
      const raw = row[columnIndex + 1];
      return [column.id, parseCellValue(raw, column)];
    })),
  }));
  return { id: makeId('table'), name: sheetName || '匯入表格', rowHeaderName, rowHeader, textScale: 1, columns, rows: rowsData, updatedAt: Date.now() };
};

const parseWorkspaceRows = (rows: SheetRows, marker: string): Pick<WorkspaceData, 'nodes' | 'activeNodeId'> => {
  assertSheetVersion(rows, marker, CURRENT_XLSX_FORMAT_VERSION);
  const activeNodeId = stringValue(rows[2]?.[1]) || null;
  const nodes = rows.filter((row) => stringValue(row[0]) === 'node').map((row) => ({
    id: stringValue(row[1]) || makeId('node'), type: stringValue(row[2]) === 'folder' ? 'folder' : 'table', name: stringValue(row[3]) || '未命名項目', parentId: stringValue(row[4]) || null, order: typeof row[5] === 'number' ? row[5] : Number(row[5]) || 0, ...(stringValue(row[6]) ? { tableId: stringValue(row[6]) } : {}),
  } as WorkspaceNode));
  return { nodes, activeNodeId };
};

const parseWorkspace = (rows: SheetRows): Pick<WorkspaceData, 'nodes' | 'activeNodeId'> => parseWorkspaceRows(rows, WORKSPACE_MARKER);

const parseBackupManifest = (rows: SheetRows): ImportedWorkspaceBackupManifest => {
  const parsed = parseWorkspaceRows(rows, BACKUP_MANIFEST_MARKER);
  const sourceUpdatedAt = Number(rows.find((row) => stringValue(row[0]) === 'source_updated_at')?.[1]);
  const folders = rows.filter((row) => stringValue(row[0]) === 'folder_file').map((row) => ({
    id: stringValue(row[1]),
    name: stringValue(row[2]),
    parentId: stringValue(row[3]) || null,
    order: Number(row[4]) || 0,
    driveFolderId: stringValue(row[5]),
  })).filter((folder) => folder.id && folder.driveFolderId);
  const tables = rows.filter((row) => stringValue(row[0]) === 'table_file').map((row) => ({
    id: stringValue(row[1]),
    nodeId: stringValue(row[2]),
    folderId: stringValue(row[3]) || null,
    name: stringValue(row[4]),
    updatedAt: Number(row[5]) || 0,
    driveFileId: stringValue(row[6]),
    fileName: stringValue(row[7]),
  })).filter((table) => table.id && table.nodeId && table.driveFileId && table.fileName);
  if (!Number.isFinite(sourceUpdatedAt)) throw new Error('備份試算表缺少來源更新時間');
  return { ...parsed, sourceUpdatedAt, folders, tables };
};

const readUint16 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
const readUint32 = (bytes: Uint8Array, offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

const readStoredXlsx = async (file: Blob): Promise<Array<Sheet<number>>> => {
  const bytes = new Uint8Array(await (typeof file.arrayBuffer === 'function'
    ? file.arrayBuffer()
    : new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('無法讀取試算表'));
      reader.readAsArrayBuffer(file);
    })));
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

export const importWorkspaceBackupManifestXlsx = async (file: Blob): Promise<ImportedWorkspaceBackupManifest> => {
  let sheets: Array<Sheet<number>>;
  try {
    sheets = await readStoredXlsx(file);
  } catch {
    sheets = await readXlsxFile(file);
  }
  const manifestSheet = sheets.find((sheet) => stringValue(sheet.data[0]?.[0]) === BACKUP_MANIFEST_MARKER);
  if (!manifestSheet) throw new Error('不是支援的 Workspace 試算表備份索引');
  return parseBackupManifest(manifestSheet.data);
};

const remapTable = (table: WorkspaceTable): WorkspaceTable => {
  const columnMap = new Map(table.columns.map((column) => [column.id, makeId('column')]));
  const columns = table.columns.map((column) => ({ ...column, id: columnMap.get(column.id)!, options: [...column.options] }));
  const tableId = makeId('table');
  const rowHeader = { ...getRowHeaderColumn(table), id: `row-header-${tableId}`, options: [...getRowHeaderColumn(table).options] };
  const cloneValue = (value: WorkspaceCellValue): WorkspaceCellValue => isWorkspaceLinkValue(value) ? { ...value } : value;
  return { ...table, id: tableId, name: `${table.name}（匯入）`, rowHeaderName: rowHeader.name, rowHeader, columns, rows: table.rows.map((row) => ({ id: makeId('row'), name: cloneValue(row.name), values: Object.fromEntries(table.columns.map((column) => [columnMap.get(column.id)!, cloneValue(row.values[column.id] ?? null)])) })), updatedAt: Date.now() };
};

export interface ImportedWorkspace {
  isWorkspace: boolean;
  source: WorkspaceImportSource;
  table?: WorkspaceTable;
  data?: WorkspaceData;
}

export type WorkspaceImportSource = 'plain' | 'structured' | 'workspace';

export const importWorkspaceXlsx = async (file: Blob, options: { preserveIds?: boolean } = {}): Promise<ImportedWorkspace> => {
  let sheets: Array<Sheet<number>>;
  try {
    sheets = await readStoredXlsx(file);
  } catch {
    sheets = await readXlsxFile(file);
  }
  if (!sheets.length) throw new Error('試算表沒有工作表');
  const markerOf = (sheet: Sheet<number>) => stringValue(sheet.data[0]?.[0]);
  const workspaceSheets = sheets.filter((sheet) => markerOf(sheet) === WORKSPACE_MARKER);
  if (workspaceSheets.length > 1) throw new Error('試算表包含多個 Workspace 設定頁');
  const workspaceSheet = workspaceSheets[0];
  const settingsSheets = sheets.filter((sheet: Sheet<number>) => stringValue(sheet.data[0]?.[0]) === TABLE_SETTINGS_MARKER);
  const unknownReservedSheet = sheets.find((sheet) => markerOf(sheet).startsWith('__workspace') && ![WORKSPACE_MARKER, TABLE_SETTINGS_MARKER].includes(markerOf(sheet)));
  if (unknownReservedSheet) throw new Error(`無法辨識的 Workspace 格式標記：${markerOf(unknownReservedSheet)}`);
  for (const settingsSheet of settingsSheets) assertSheetVersion(settingsSheet.data, TABLE_SETTINGS_MARKER, CURRENT_XLSX_FORMAT_VERSION);
  const parseSettingsSheet = (settingsSheet: Sheet<number>) => {
    const dataSheetName = stringValue(settingsSheet.data.find((row) => stringValue(row[0]) === 'data_sheet')?.[1]);
    const matchingDataSheets = sheets.filter((sheet) => sheet.sheet === dataSheetName);
    if (matchingDataSheets.length > 1) throw new Error(`資料工作表名稱不唯一：${dataSheetName}`);
    const dataSheet = matchingDataSheets[0];
    if (!dataSheet) throw new Error(`找不到資料工作表：${dataSheetName}`);
    return parseSeparatedTable(settingsSheet.data, dataSheet.data);
  };
  if (!workspaceSheet) {
    if (settingsSheets.length > 1) throw new Error('匯入單表時只能包含一組表格設定');
    const table = settingsSheets.length
      ? parseSettingsSheet(settingsSheets[0])
      : parsePlainTable(sheets[0].data, sheets[0].sheet);
    return { isWorkspace: false, source: settingsSheets.length ? 'structured' : 'plain', table: options.preserveIds ? table : remapTable(table) };
  }
  const parsed = parseWorkspace(workspaceSheet.data);
  const tables = settingsSheets.map(parseSettingsSheet);
  const tableMap = new Map(tables.map((table) => [table.id, table]));
  const data: WorkspaceData = { version: 1, nodes: parsed.nodes, tables, activeNodeId: parsed.activeNodeId };
  for (const node of data.nodes) {
    if (node.type === 'table' && (!node.tableId || !tableMap.has(node.tableId))) throw new Error(`找不到表格：${node.name}`);
  }
  return { isWorkspace: true, source: 'workspace', data };
};

export const cloneImportedWorkspace = (data: WorkspaceData): WorkspaceData => {
  const folderMap = new Map<string, string>();
  const tableMap = new Map<string, string>();
  for (const node of data.nodes) folderMap.set(node.id, makeId(node.type));
  const tables = data.tables.map((table) => {
    const copy = remapTable(table); tableMap.set(table.id, copy.id); return copy;
  });
  const nodes = data.nodes.map((node) => ({
    ...node,
    id: folderMap.get(node.id)!,
    parentId: node.parentId ? folderMap.get(node.parentId) ?? null : null,
    tableId: node.tableId ? tableMap.get(node.tableId) : undefined,
  }));
  return { version: 1, nodes, tables, activeNodeId: null };
};
