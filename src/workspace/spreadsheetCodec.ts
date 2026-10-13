import type { CellValue, Sheet } from 'read-excel-file/browser';
import { createWorkspaceValueReader } from './formula/values';
import { getRowHeaderColumn, isWorkspaceLinkValue } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceLinkValue, WorkspaceNode, WorkspaceRow, WorkspaceTable } from './types';
import { WORKSPACE_FORMAT } from './types';
export { safeSheetName, workbookFromRows, workbookFromRowsSteps, zipStoreBytes, zipStoreBytesAsync } from './spreadsheetWorkbook';

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

type SerializedColumnFields = 'id' | 'name' | 'inputType' | 'numberInputMode' | 'options' | 'optionColors' | 'numberRanges' | 'hidden' | 'isMultiple' | 'alignment' | 'overflowMode' | 'widthLimitChars' | 'lineLimit' | 'dateOnly' | 'formula';

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
  column.formula ? JSON.stringify(column.formula) : '',
];

export const tableSettingsRows = (table: WorkspaceTable, dataSheetName: string): unknown[][] => {
  const rowHeader = getRowHeaderColumn(table);
  return [
  [TABLE_SETTINGS_MARKER, table.columns.some(column => column.formula) ? 2 : CURRENT_XLSX_FORMAT_VERSION],
  ['data_sheet', dataSheetName],
  ['table_id', table.id],
  ['change_revision', table.changeRevision ?? ''],
  ['table_name', table.name],
  ['row_header_name', rowHeader.name],
  ['text_scale', table.textScale ?? 1],
  ['transposed_view', table.transposed ? 'true' : 'false'],
  serializeColumnSettings('row_header', rowHeader),
  ['columns', 'id', 'name', 'inputType', 'options', 'alignment', 'overflowMode', 'optionColors', 'numberRanges', 'hidden', 'isMultiple', 'widthLimitChars', 'dateOnly', 'lineLimit', 'numberInputMode', 'formula'],
  ...table.columns.map((column) => serializeColumnSettings('column', column)),
  ];
};

export function* iterateTableDataRows(table: WorkspaceTable): Generator<unknown[]> {
  const reader = createWorkspaceValueReader();
  yield [getRowHeaderColumn(table).name, ...table.columns.map(column => column.name)];
  for (const row of table.rows) {
    yield [serializeDataCellValue(row.name), ...table.columns.map(column => serializeDataCellValue(reader.read(row, column).value))];
    reader.releaseRow(row.id);
  }
}
export const tableDataRows = (table: WorkspaceTable): unknown[][] => [...iterateTableDataRows(table)];

export const workspaceRows = (data: WorkspaceData): unknown[][] => [
  [WORKSPACE_MARKER, CURRENT_XLSX_FORMAT_VERSION],
  ['format', WORKSPACE_FORMAT],
  ['active_node_id', data.activeNodeId ?? ''],
  ['structure_revision', data.structureRevision ?? ''],
  ['bottom_navigation_table_ids', ...(data.bottomNavigationTableIds ?? [])],
  ['nodes', 'id', 'type', 'name', 'parentId', 'order', 'tableId'],
  ...data.nodes.map((node) => ['node', node.id, node.type, node.name, node.parentId ?? '', node.order, node.tableId ?? '']),
];

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
