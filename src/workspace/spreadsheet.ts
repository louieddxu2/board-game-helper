import type { Sheet } from 'read-excel-file/browser';
import { workspaceTableChangeRevision } from './changeRevisions';
import { createColumn, ensureTableDynamicOptions, getRowHeaderColumn, isWorkspaceColor, isWorkspaceLinkValue, isWorkspaceUrlText, makeId, normalizeWorkspaceDateTime, readDynamicOptions } from './model';
import { assertWorkspaceTableComplete } from './rowPages';
import type { SheetCell, SheetRows } from './spreadsheetCodec';
import { BACKUP_MANIFEST_MARKER, CURRENT_XLSX_FORMAT_VERSION, INPUT_TYPES, NUMBER_RANGES_JSON_MARKER, OPTIONS_JSON_MARKER, OPTION_COLORS_JSON_MARKER, TABLE_SETTINGS_MARKER, WORKSPACE_ARCHIVE_ROOT, WORKSPACE_MARKER, blobBytes, readStoredXlsx, readStoredZip, readXlsxFile, safeSheetName, tableDataRows, tableSettingsRows, workbookFromRows, workspaceRows, zipStoreBytes } from './spreadsheetCodec';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceNode, WorkspaceNumberInputMode, WorkspaceNumberRange, WorkspaceOverflowMode, WorkspaceRow, WorkspaceTable, WorkspaceTextAlign } from './types';

export interface WorkspaceBackupTableFileRef {
  id: string;
  nodeId: string;
  folderId: string | null;
  name: string;
  updatedAt: number;
  /** Optional in v1 manifests so older backups remain importable. */
  changeRevision?: string;
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
  structureRevision?: string;
  activeNodeId: string | null;
  bottomNavigationTableIds: string[];
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
    ['structure_revision', data.structureRevision ?? ''],
    ['bottom_navigation_table_ids', ...(data.bottomNavigationTableIds ?? [])],
    ['nodes', 'id', 'type', 'name', 'parentId', 'order', 'tableId'],
    ...data.nodes.map((node) => ['node', node.id, node.type, node.name, node.parentId ?? '', node.order, node.tableId ?? '']),
    ['folder_files', 'id', 'name', 'parentId', 'order', 'driveFolderId'],
    ...folders.map((folder) => ['folder_file', folder.id, folder.name, folder.parentId ?? '', folder.order, folder.driveFolderId]),
    ['table_files', 'id', 'nodeId', 'folderId', 'name', 'updatedAt', 'driveFileId', 'fileName', 'changeRevision'],
    ...tables.map((table) => ['table_file', table.id, table.nodeId, table.folderId ?? '', table.name, table.updatedAt, table.driveFileId, table.fileName, table.changeRevision ?? '']),
  ],
}]);

export const exportWorkspaceXlsx = (data: WorkspaceData, table?: WorkspaceTable) => {
  const tables = table ? [table] : data.tables;
  if (!table && data.nodes.some(node => node.type === 'table' && !tables.some(table => table.id === node.tableId))) throw new Error('工作區表格尚未完整載入，無法匯出');
  tables.forEach(assertWorkspaceTableComplete);
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

const archivePathSegment = (name: string) => name
  .replace(/[\\/:*?"<>|]/g, ' ')
  .replace(/[\u0000-\u001f]/g, ' ')
  .trim() || '未命名';

const archiveFolderSegments = (node: WorkspaceNode, nodes: Map<string, WorkspaceNode>) => {
  const segments: string[] = [];
  const visited = new Set<string>();
  let parentId = node.parentId;
  while (parentId) {
    if (visited.has(parentId)) throw new Error('工作區資料夾結構包含循環');
    visited.add(parentId);
    const parent = nodes.get(parentId);
    if (!parent) throw new Error(`找不到資料夾：${parentId}`);
    if (parent.type !== 'folder') throw new Error(`表格父層不是資料夾：${node.name}`);
    segments.unshift(archivePathSegment(parent.name));
    parentId = parent.parentId;
  }
  return segments;
};

const localBackupRefs = (data: WorkspaceData) => {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const folders: WorkspaceBackupFolderRef[] = data.nodes
    .filter((node) => node.type === 'folder')
    .map((node) => ({ id: node.id, name: node.name, parentId: node.parentId, order: node.order, driveFolderId: '' }));
  const tables: WorkspaceBackupTableFileRef[] = data.nodes
    .filter((node) => node.type === 'table' && node.tableId)
    .map((node) => {
      const table = data.tables.find((item) => item.id === node.tableId);
      if (!table) throw new Error(`找不到表格資料：${node.name}`);
      const baseName = (table.name || node.name || table.id).replace(/\.xlsx$/i, '');
      return { id: table.id, nodeId: node.id, folderId: node.parentId, name: table.name, updatedAt: table.updatedAt, driveFileId: '', fileName: `${archivePathSegment(baseName)}.xlsx` };
    });
  return { nodes, folders, tables };
};
const blobFromBytes = (bytes: Uint8Array, type: string) => new Blob([bytes.slice().buffer as ArrayBuffer], { type });

export const exportWorkspaceArchive = async (data: WorkspaceData) => {
  const { nodes, folders, tables } = localBackupRefs(data);
  const entries: Array<{ name: string; content: Uint8Array }> = [{
    name: `${WORKSPACE_ARCHIVE_ROOT}/manifest.xlsx`,
    content: await blobBytes(exportWorkspaceBackupManifestXlsx(data, folders, tables, Date.now())),
  }];
  for (const ref of tables) {
    const node = data.nodes.find((item) => item.id === ref.nodeId);
    const table = data.tables.find((item) => item.id === ref.id);
    if (!node || !table) throw new Error(`找不到匯出表格：${ref.name}`);
    const path = [WORKSPACE_ARCHIVE_ROOT, ...archiveFolderSegments(node, nodes), ref.fileName].join('/');
    entries.push({ name: path, content: await blobBytes(exportWorkspaceXlsx(data, table)) });
  }
  return zipStoreBytes(entries, 'application/zip');
};
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
    if (parts.length > 1 && (!possibleUrl || /^https?:\/\//i.test(possibleUrl) || isWorkspaceUrlText(possibleUrl))) return { url: possibleUrl, label: parts.slice(0, -1).join('\n').trim() };
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
  const changeRevision = stringValue(settingsRows.find((row) => stringValue(row[0]) === 'change_revision')?.[1]);
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
  return { id: tableId, ...(changeRevision ? { changeRevision } : {}), name: tableName, rowHeaderName: rowHeader.name, rowHeader, textScale, transposed, columns, rows, updatedAt: Date.now() };
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

type ParsedWorkspaceRows = { nodes: WorkspaceNode[]; structureRevision?: string; activeNodeId: string | null; bottomNavigationTableIds: string[] };

const parseWorkspaceRows = (rows: SheetRows, marker: string): ParsedWorkspaceRows => {
  assertSheetVersion(rows, marker, CURRENT_XLSX_FORMAT_VERSION);
  const activeNodeId = stringValue(rows.find((row) => stringValue(row[0]) === 'active_node_id')?.[1]) || null;
  const bottomNavigationTableIds = (rows.find((row) => stringValue(row[0]) === 'bottom_navigation_table_ids') ?? []).slice(1).map(stringValue).filter(Boolean);
  const nodes = rows.filter((row) => stringValue(row[0]) === 'node').map((row) => ({
    id: stringValue(row[1]) || makeId('node'), type: stringValue(row[2]) === 'folder' ? 'folder' : 'table', name: stringValue(row[3]) || '未命名項目', parentId: stringValue(row[4]) || null, order: typeof row[5] === 'number' ? row[5] : Number(row[5]) || 0, ...(stringValue(row[6]) ? { tableId: stringValue(row[6]) } : {}),
  } as WorkspaceNode));
  const structureRevision = stringValue(rows.find((row) => stringValue(row[0]) === 'structure_revision')?.[1]);
  return { nodes, ...(structureRevision ? { structureRevision } : {}), activeNodeId, bottomNavigationTableIds };
};

const parseWorkspace = (rows: SheetRows): ParsedWorkspaceRows => parseWorkspaceRows(rows, WORKSPACE_MARKER);

const parseBackupManifest = (rows: SheetRows): ImportedWorkspaceBackupManifest => {
  const parsed = parseWorkspaceRows(rows, BACKUP_MANIFEST_MARKER);
  const sourceUpdatedAt = Number(rows.find((row) => stringValue(row[0]) === 'source_updated_at')?.[1]);
  const folders = rows.filter((row) => stringValue(row[0]) === 'folder_file').map((row) => ({
    id: stringValue(row[1]),
    name: stringValue(row[2]),
    parentId: stringValue(row[3]) || null,
    order: Number(row[4]) || 0,
    driveFolderId: stringValue(row[5]),
  })).filter((folder) => folder.id);
  const tableHeader = rows.find((row) => stringValue(row[0]) === 'table_files') ?? [];
  const tableColumn = (name: string, fallback: number) => {
    const index = tableHeader.findIndex((value) => stringValue(value) === name);
    return index >= 0 ? index : fallback;
  };
  const tables = rows.filter((row) => stringValue(row[0]) === 'table_file').map((row) => ({
    id: stringValue(row[1]),
    nodeId: stringValue(row[2]),
    folderId: stringValue(row[3]) || null,
    name: stringValue(row[4]),
    updatedAt: Number(row[tableColumn('updatedAt', 5)]) || 0,
    ...(stringValue(row[tableColumn('changeRevision', -1)]) ? { changeRevision: stringValue(row[tableColumn('changeRevision', -1)]) } : {}),
    driveFileId: stringValue(row[tableColumn('driveFileId', 6)]),
    fileName: stringValue(row[tableColumn('fileName', 7)]),
  })).filter((table) => table.id && table.nodeId && table.fileName);
  if (!Number.isFinite(sourceUpdatedAt)) throw new Error('備份試算表缺少來源更新時間');
  return { ...parsed, sourceUpdatedAt, folders, tables };
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

export const importWorkspaceArchive = async (file: Blob): Promise<ImportedWorkspace> => {
  const entries = await readStoredZip(file);
  const manifestPath = `${WORKSPACE_ARCHIVE_ROOT}/manifest.xlsx`;
  const manifestBytes = entries.get(manifestPath);
  if (!manifestBytes) throw new Error('ZIP 備份缺少 manifest.xlsx');
  const manifest = await importWorkspaceBackupManifestXlsx(blobFromBytes(manifestBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const nodeMap = new Map(manifest.nodes.map((node) => [node.id, node]));
  const tableRefs = new Map(manifest.tables.map((ref) => [ref.id, ref]));
  const tables: WorkspaceTable[] = [];
  for (const ref of manifest.tables) {
    const node = nodeMap.get(ref.nodeId);
    if (!node || node.type !== 'table' || node.tableId !== ref.id) throw new Error(`備份索引的表格結構錯誤：${ref.name}`);
    if (!ref.fileName || ref.fileName.includes('/') || ref.fileName.includes('\\') || ref.fileName.includes('..')) throw new Error(`備份索引的表格檔名不安全：${ref.name}`);
    const tablePath = [WORKSPACE_ARCHIVE_ROOT, ...archiveFolderSegments(node, nodeMap), ref.fileName].join('/');
    const tableBytes = entries.get(tablePath);
    if (!tableBytes) throw new Error(`ZIP 備份缺少表格：${ref.name}`);
    const imported = await importWorkspaceXlsx(blobFromBytes(tableBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), { preserveIds: true });
    if (!imported.table || imported.table.id !== ref.id) throw new Error(`ZIP 備份表格格式錯誤：${ref.name}`);
    tables.push(imported.table);
  }
  for (const node of manifest.nodes.filter((item) => item.type === 'table')) {
    if (!node.tableId || !tableRefs.has(node.tableId)) throw new Error(`ZIP 備份缺少表格索引：${node.name}`);
  }
  return { isWorkspace: true, source: 'workspace', data: { version: 1, structureRevision: manifest.structureRevision, nodes: manifest.nodes, tables, activeNodeId: manifest.activeNodeId, bottomNavigationTableIds: manifest.bottomNavigationTableIds } };
};

const remapTable = (table: WorkspaceTable): WorkspaceTable => {
  const updatedAt = Date.now();
  const sourceRevision = workspaceTableChangeRevision(table);
  const targetRevision = workspaceTableChangeRevision({ ...table, updatedAt });
  // ID remapping copies the same values. Legacy timestamp revisions still need retagging.
  const copyColumn = (column: WorkspaceColumn, id: string): WorkspaceColumn => ({
    ...column, id, options: [...column.options],
    dynamicOptions: readDynamicOptions(column, sourceRevision) && column.dynamicOptions
      ? { ...column.dynamicOptions, sourceRevision: targetRevision } : undefined,
  });
  const columnMap = new Map(table.columns.map((column) => [column.id, makeId('column')]));
  const columns = table.columns.map((column) => copyColumn(column, columnMap.get(column.id)!));
  const tableId = makeId('table');
  const rowHeader = copyColumn(getRowHeaderColumn(table), `row-header-${tableId}`);
  const cloneValue = (value: WorkspaceCellValue): WorkspaceCellValue => isWorkspaceLinkValue(value) ? { ...value } : value;
  return { ...table, id: tableId, name: `${table.name}（匯入）`, rowHeaderName: rowHeader.name, rowHeader, columns, rows: table.rows.map((row) => ({ id: makeId('row'), name: cloneValue(row.name), values: Object.fromEntries(table.columns.map((column) => [columnMap.get(column.id)!, cloneValue(row.values[column.id] ?? null)])) })), updatedAt };
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
    return { isWorkspace: false, source: settingsSheets.length ? 'structured' : 'plain', table: ensureTableDynamicOptions(options.preserveIds ? table : remapTable(table)) };
  }
  const parsed = parseWorkspace(workspaceSheet.data);
  const tables = settingsSheets.map(sheet => ensureTableDynamicOptions(parseSettingsSheet(sheet)));
  const tableMap = new Map(tables.map((table) => [table.id, table]));
  const data: WorkspaceData = { version: 1, structureRevision: parsed.structureRevision, nodes: parsed.nodes, tables, activeNodeId: parsed.activeNodeId, bottomNavigationTableIds: parsed.bottomNavigationTableIds };
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
  return { version: 1, nodes, tables, activeNodeId: null, bottomNavigationTableIds: (data.bottomNavigationTableIds ?? []).flatMap((tableId) => tableMap.get(tableId) ?? []) };
};

export { WORKSPACE_ARCHIVE_FILE_NAME, WORKSPACE_ARCHIVE_ROOT } from './spreadsheetCodec';

export type { WorkspaceXlsxSchemaCoverage } from './spreadsheetCodec';
