import readXlsxFile, { type CellValue, type Sheet } from 'read-excel-file/browser';
import { createColumn, createNode, createRow, createTable, makeId } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceNode, WorkspaceRow, WorkspaceTable, WorkspaceTextAlign } from './types';
import { WORKSPACE_FORMAT, WORKSPACE_FORMAT_VERSION } from './types';

const TABLE_MARKER = '__workspace_table';
const WORKSPACE_MARKER = '__workspace';
const OPTIONS_JSON_MARKER = '__workspace_options_json:';
const INPUT_TYPES: WorkspaceInputType[] = ['text', 'number', 'select', 'dynamic-select'];

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
  const cells = rows.map((row, rowIndex) => {
    const values = row.map((value, columnIndex) => xmlCell(rowIndex + 1, columnIndex, value)).join('');
    return `<row r="${rowIndex + 1}">${values}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(maxColumns - 1)}${maxRows}"/><sheetData>${cells}</sheetData></worksheet>`;
};

const tableRows = (table: WorkspaceTable): unknown[][] => [
  [TABLE_MARKER, WORKSPACE_FORMAT_VERSION],
  ['table_id', table.id],
  ['table_name', table.name],
  ['row_header_name', table.rowHeaderName],
  ['text_scale', table.textScale ?? 1],
  ['columns', 'id', 'name', 'inputType', 'options', 'alignment'],
  ...table.columns.map((column) => ['column', column.id, column.name, column.inputType, `${OPTIONS_JSON_MARKER}${JSON.stringify(column.options)}`, column.alignment ?? 'left']),
  ['data', 'row_id', 'row_name', ...table.columns.map((column) => column.id)],
  ...table.rows.map((row) => [row.id, row.name, ...table.columns.map((column) => row.values[column.id] ?? null)]),
];

const workspaceRows = (data: WorkspaceData): unknown[][] => [
  [WORKSPACE_MARKER, WORKSPACE_FORMAT_VERSION],
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

export const exportWorkspaceXlsx = (data: WorkspaceData, table?: WorkspaceTable) => {
  const tables = table ? [table] : data.tables;
  const files: Array<{ name: string; content: string }> = [];
  const names: string[] = [];
  const usedNames = new Set<string>();
  if (!table) {
    names.push(safeSheetName('__workspace', usedNames));
    files.push({ name: 'xl/worksheets/sheet1.xml', content: sheetXml(workspaceRows(data)) });
  }
  for (const currentTable of tables) {
    names.push(safeSheetName(currentTable.name, usedNames));
    files.push({ name: `xl/worksheets/sheet${files.length + 1}.xml`, content: sheetXml(tableRows(currentTable)) });
  }
  const sheetCount = names.length;
  files.push({ name: 'xl/workbook.xml', content: workbookXml(names) });
  files.push({ name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml(sheetCount) });
  files.push({ name: '_rels/.rels', content: rootRelsXml });
  files.push({ name: '[Content_Types].xml', content: contentTypesXml(sheetCount) });
  return zipStore(files);
};

type SheetCell = CellValue<number> | null;
type SheetRows = SheetCell[][];
const stringValue = (value: SheetCell | undefined) => value === null || value === undefined ? '' : String(value);
const parseType = (value: string): WorkspaceInputType => INPUT_TYPES.includes(value as WorkspaceInputType) ? value as WorkspaceInputType : 'text';
const parseAlignment = (value: string): WorkspaceTextAlign => value === 'center' || value === 'right' ? value : 'left';
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

const parseTable = (rows: SheetRows): WorkspaceTable => {
  if (stringValue(rows[0]?.[0]) !== TABLE_MARKER) throw new Error('找不到動態表格格式標記');
  const tableName = stringValue(rows[2]?.[1]) || '匯入表格';
  const rowHeaderName = stringValue(rows.find((row) => stringValue(row[0]) === 'row_header_name')?.[1]) || '項目';
  const textScaleValue = Number(rows.find((row) => stringValue(row[0]) === 'text_scale')?.[1]);
  const textScale = Number.isFinite(textScaleValue) ? Math.max(0.1, Math.min(2.5, textScaleValue)) : 1;
  const columns: WorkspaceColumn[] = [];
  for (const row of rows) {
    if (stringValue(row[0]) !== 'column') continue;
    const column = createColumn(stringValue(row[2]) || '未命名欄位', parseType(stringValue(row[3])));
    column.id = stringValue(row[1]) || column.id;
    column.options = parseOptions(stringValue(row[4]));
    column.alignment = parseAlignment(stringValue(row[5]));
    columns.push(column);
  }
  if (!columns.length) throw new Error('匯入表格沒有欄位');
  const dataIndex = rows.findIndex((row) => stringValue(row[0]) === 'data');
  if (dataIndex < 0) throw new Error('匯入表格沒有資料區');
  const hasRowName = stringValue(rows[dataIndex]?.[2]) === 'row_name';
  const rowsData: WorkspaceRow[] = rows.slice(dataIndex + 1).filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== '')).map((row, index) => ({
    id: stringValue(row[0]) || makeId('row'),
    name: hasRowName ? stringValue(row[1]) || `項目 ${index + 1}` : `項目 ${index + 1}`,
    values: Object.fromEntries(columns.map((column, columnIndex) => {
      const raw = row[columnIndex + (hasRowName ? 2 : 1)];
      return [column.id, column.inputType === 'number' && typeof raw === 'number' ? raw : stringValue(raw) || null];
    })),
  }));
  return { id: stringValue(rows[1]?.[1]) || makeId('table'), name: tableName, rowHeaderName, textScale, columns, rows: rowsData, updatedAt: Date.now() };
};

const uniqueColumnName = (candidate: string, index: number, used: Set<string>) => {
  const base = candidate.trim() || `欄位 ${index + 1}`;
  let name = base;
  let suffix = 2;
  while (used.has(name)) name = `${base} ${suffix++}`;
  used.add(name);
  return name;
};

const parsePlainTable = (rows: SheetRows, sheetName: string): WorkspaceTable => {
  const header = rows[0] ?? [];
  if (header.length < 2) throw new Error('試算表至少需要項目欄與一個屬性欄');
  const rowHeaderName = stringValue(header[0]) || '項目';
  const usedNames = new Set<string>();
  const columns = header.slice(1).map((value, index) => ({
    ...createColumn(uniqueColumnName(stringValue(value), index, usedNames)),
    inputType: 'text' as const,
  }));
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell !== null && cell !== undefined && cell !== ''));
  const rowsData: WorkspaceRow[] = dataRows.map((row, rowIndex) => ({
    id: makeId('row'),
    name: stringValue(row[0]) || `項目 ${rowIndex + 1}`,
    values: Object.fromEntries(columns.map((column, columnIndex) => {
      const raw = row[columnIndex + 1];
      return [column.id, raw === null || raw === undefined || raw === '' ? null : typeof raw === 'number' && Number.isFinite(raw) ? raw : String(raw)];
    })),
  }));
  return { id: makeId('table'), name: sheetName || '匯入表格', rowHeaderName, textScale: 1, columns, rows: rowsData, updatedAt: Date.now() };
};

const parseWorkspace = (rows: SheetRows): Pick<WorkspaceData, 'nodes' | 'activeNodeId'> => {
  if (stringValue(rows[0]?.[0]) !== WORKSPACE_MARKER) throw new Error('找不到 Workspace 格式標記');
  const activeNodeId = stringValue(rows[2]?.[1]) || null;
  const nodes = rows.filter((row) => stringValue(row[0]) === 'node').map((row) => ({
    id: stringValue(row[1]) || makeId('node'), type: stringValue(row[2]) === 'folder' ? 'folder' : 'table', name: stringValue(row[3]) || '未命名項目', parentId: stringValue(row[4]) || null, order: typeof row[5] === 'number' ? row[5] : Number(row[5]) || 0, ...(stringValue(row[6]) ? { tableId: stringValue(row[6]) } : {}),
  } as WorkspaceNode));
  return { nodes, activeNodeId };
};

const readUint16 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
const readUint32 = (bytes: Uint8Array, offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

const readStoredXlsx = async (file: Blob): Promise<Array<Sheet<number>>> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
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

const remapTable = (table: WorkspaceTable): WorkspaceTable => {
  const columnMap = new Map(table.columns.map((column) => [column.id, makeId('column')]));
  const columns = table.columns.map((column) => ({ ...column, id: columnMap.get(column.id)!, options: [...column.options] }));
  return { ...table, id: makeId('table'), name: `${table.name}（匯入）`, rowHeaderName: table.rowHeaderName, columns, rows: table.rows.map((row) => ({ id: makeId('row'), name: row.name, values: Object.fromEntries(table.columns.map((column) => [columnMap.get(column.id)!, row.values[column.id] ?? null])) })), updatedAt: Date.now() };
};

export interface ImportedWorkspace {
  isWorkspace: boolean;
  table?: WorkspaceTable;
  data?: WorkspaceData;
}

export const importWorkspaceXlsx = async (file: Blob): Promise<ImportedWorkspace> => {
  let sheets: Array<Sheet<number>>;
  try {
    sheets = await readStoredXlsx(file);
  } catch {
    sheets = await readXlsxFile(file);
  }
  if (!sheets.length) throw new Error('試算表沒有工作表');
  const workspaceSheet = sheets.find((sheet: Sheet<number>) => stringValue(sheet.data[0]?.[0]) === WORKSPACE_MARKER);
  if (!workspaceSheet) {
    const table = stringValue(sheets[0].data[0]?.[0]) === TABLE_MARKER
      ? parseTable(sheets[0].data)
      : parsePlainTable(sheets[0].data, sheets[0].sheet);
    return { isWorkspace: false, table: remapTable(table) };
  }
  const parsed = parseWorkspace(workspaceSheet.data);
  const tableSheets = sheets.filter((sheet: Sheet<number>) => sheet !== workspaceSheet);
  const tables = tableSheets.map((sheet) => parseTable(sheet.data));
  const tableMap = new Map(tables.map((table) => [table.id, table]));
  const data: WorkspaceData = { version: 1, nodes: parsed.nodes, tables, activeNodeId: parsed.activeNodeId };
  for (const node of data.nodes) {
    if (node.type === 'table' && (!node.tableId || !tableMap.has(node.tableId))) throw new Error(`找不到表格：${node.name}`);
  }
  return { isWorkspace: true, data };
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
