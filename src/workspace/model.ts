import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceLinkValue, WorkspaceNode, WorkspaceOverflowMode, WorkspaceRow, WorkspaceTable } from './types';

const DEFAULT_ROW_HEADER_NAME = '項目';

export const makeId = (prefix: string) => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
};

export const emptyWorkspace = (): WorkspaceData => ({ version: 1, nodes: [], tables: [], activeNodeId: null });

export const createColumn = (name: string, inputType: WorkspaceInputType = 'text'): WorkspaceColumn => ({
  id: makeId('column'), name: name.trim() || '未命名欄位', inputType, options: [], alignment: 'left', overflowMode: inputType === 'link' ? 'ellipsis' : 'wrap',
});

export const createRow = (columns: WorkspaceColumn[], name = '項目 1'): WorkspaceRow => ({
  id: makeId('row'), name, values: Object.fromEntries(columns.map((column) => [column.id, null])),
});

export const createTable = (name: string): WorkspaceTable => {
  const columns = [createColumn('屬性 1', 'text')];
  const tableId = makeId('table');
  const rowHeader = { ...createColumn(DEFAULT_ROW_HEADER_NAME, 'text'), id: `row-header-${tableId}`, overflowMode: 'expand' as const };
  return { id: tableId, name: name.trim() || '未命名表格', rowHeaderName: DEFAULT_ROW_HEADER_NAME, rowHeader, textScale: 1, columns, rows: [createRow(columns)], updatedAt: Date.now() };
};

const normalizeOverflowMode = (value: WorkspaceOverflowMode | undefined, inputType: WorkspaceInputType, fallback: WorkspaceOverflowMode = 'wrap'): WorkspaceOverflowMode => value === 'expand' || value === 'ellipsis' || value === 'wrap' ? value : inputType === 'link' ? 'ellipsis' : fallback;

const normalizeColumn = (column: WorkspaceColumn, fallbackOverflow: WorkspaceOverflowMode = 'wrap'): WorkspaceColumn => ({
  ...column,
  inputType: column.inputType === 'link' || column.inputType === 'datetime' || column.inputType === 'number' || column.inputType === 'select' || column.inputType === 'dynamic-select' ? column.inputType : 'text',
  options: Array.isArray(column.options) ? column.options : [],
  alignment: column.alignment ?? 'left',
  overflowMode: normalizeOverflowMode(column.overflowMode, column.inputType, fallbackOverflow),
});

export const isWorkspaceLinkValue = (value: WorkspaceCellValue | unknown): value is WorkspaceLinkValue => Boolean(value && typeof value === 'object' && 'url' in value && typeof value.url === 'string' && 'label' in value && typeof value.label === 'string');

export const normalizeWorkspaceDateTime = (value: WorkspaceCellValue): string | null => {
  if (value == null || value === '' || isWorkspaceLinkValue(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const formatWorkspaceDateTime = (value: WorkspaceCellValue) => {
  const normalized = normalizeWorkspaceDateTime(value);
  if (!normalized) return '';
  const parts = new Intl.DateTimeFormat('zh-TW-u-ca-gregory', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(normalized));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}年${part('month')}月${part('day')}日${part('hour')}點${part('minute')}分`;
};

export const displayWorkspaceCellValue = (value: WorkspaceCellValue, inputType?: WorkspaceInputType) => inputType === 'datetime'
  ? formatWorkspaceDateTime(value)
  : isWorkspaceLinkValue(value) ? value.label.trim() || value.url : value == null ? '' : String(value);

export const getRowHeaderColumn = (table: WorkspaceTable): WorkspaceColumn => normalizeColumn(table.rowHeader
  ? { ...table.rowHeader, name: table.rowHeaderName?.trim() || table.rowHeader.name }
  : {
    id: `row-header-${table.id}`,
    name: table.rowHeaderName?.trim() || DEFAULT_ROW_HEADER_NAME,
    inputType: 'text',
    options: [],
    alignment: 'left',
    overflowMode: 'expand',
  }, 'expand');

const normalizeCellValue = (value: WorkspaceCellValue, inputType: WorkspaceInputType): WorkspaceCellValue => {
  if (inputType === 'link') {
    if (isWorkspaceLinkValue(value)) return { url: value.url, label: value.label };
    return typeof value === 'string' && value.trim() ? { url: value.trim(), label: '' } : null;
  }
  if (inputType === 'datetime') return normalizeWorkspaceDateTime(value);
  if (isWorkspaceLinkValue(value)) return displayWorkspaceCellValue(value) || null;
  return value ?? null;
};

export const normalizeWorkspace = (data: WorkspaceData): WorkspaceData => ({
  ...data,
  tables: data.tables.map((table) => {
    const rowHeader = getRowHeaderColumn(table);
    const columns = table.columns.map((column) => normalizeColumn(column));
    return {
      ...table,
      rowHeaderName: rowHeader.name,
      rowHeader,
      textScale: typeof table.textScale === 'number' && Number.isFinite(table.textScale) ? Math.max(0.1, Math.min(2.5, table.textScale)) : 1,
      transposed: Boolean(table.transposed),
      columns,
      rows: table.rows.map((row, index) => ({
        ...row,
        name: normalizeCellValue(row.name, rowHeader.inputType) ?? `項目 ${index + 1}`,
        values: Object.fromEntries(columns.map((column) => [column.id, normalizeCellValue(row.values[column.id] ?? null, column.inputType)])),
      })),
    };
  }),
});

export const createNode = (type: WorkspaceNode['type'], name: string, parentId: string | null, order: number, tableId?: string): WorkspaceNode => ({
  id: makeId(type), type, name: name.trim() || (type === 'folder' ? '未命名資料夾' : '未命名表格'), parentId, order, ...(tableId ? { tableId } : {}),
});

export const getTableForNode = (data: WorkspaceData, nodeId: string | null) => {
  const node = data.nodes.find((item) => item.id === nodeId && item.type === 'table');
  return node?.tableId ? data.tables.find((table) => table.id === node.tableId) : undefined;
};

export const getChildren = (data: WorkspaceData, parentId: string | null) => data.nodes
  .filter((node) => node.parentId === parentId)
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hant'));

export const getDynamicOptions = (table: WorkspaceTable, columnId: string) => {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const row of table.rows) {
    const value = columnId === getRowHeaderColumn(table).id ? row.name : row.values[columnId];
    const normalized = typeof value === 'string' ? value.trim() : '';
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    options.push(normalized);
  }
  return options;
};

export const resolveActiveTableNodeId = (data: WorkspaceData, preferredNodeId = data.activeNodeId) => {
  const tableIds = new Set(data.tables.map((table) => table.id));
  const isAvailableTable = (node: WorkspaceNode) => node.type === 'table' && Boolean(node.tableId && tableIds.has(node.tableId));
  const preferredNode = preferredNodeId ? data.nodes.find((node) => node.id === preferredNodeId) : undefined;
  return preferredNode && isAvailableTable(preferredNode)
    ? preferredNode.id
    : data.nodes.find(isAvailableTable)?.id ?? null;
};

export const coerceCellValue = (column: WorkspaceColumn, raw: string): WorkspaceCellValue => {
  if (!raw.trim()) return null;
  if (column.inputType === 'link') return { url: raw.trim(), label: '' };
  if (column.inputType === 'datetime') return normalizeWorkspaceDateTime(raw);
  if (column.inputType !== 'number') return raw;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

export const removeNodeAndDescendants = (data: WorkspaceData, nodeId: string): WorkspaceData => {
  const removedIds = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of data.nodes) {
      if (node.parentId && removedIds.has(node.parentId) && !removedIds.has(node.id)) {
        removedIds.add(node.id);
        changed = true;
      }
    }
  }
  const tableIds = new Set(data.nodes.filter((node) => removedIds.has(node.id) && node.tableId).map((node) => node.tableId));
  const remaining = { ...data, nodes: data.nodes.filter((node) => !removedIds.has(node.id)), tables: data.tables.filter((table) => !tableIds.has(table.id)) };
  return { ...remaining, activeNodeId: resolveActiveTableNodeId(remaining) };
};

export const moveNode = (data: WorkspaceData, nodeId: string, parentId: string | null): WorkspaceData => {
  const node = data.nodes.find((item) => item.id === nodeId);
  if (!node || node.parentId === parentId || parentId === nodeId) return data;
  if (parentId) {
    const parent = data.nodes.find((item) => item.id === parentId);
    if (!parent || parent.type !== 'folder') return data;
    let ancestor: WorkspaceNode | undefined = parent;
    while (ancestor) {
      if (ancestor.id === nodeId) return data;
      ancestor = ancestor.parentId ? data.nodes.find((item) => item.id === ancestor?.parentId) : undefined;
    }
  }
  const destinationOrder = getChildren(data, parentId).filter((item) => item.id !== nodeId).length;
  return { ...data, nodes: data.nodes.map((item) => item.id === nodeId ? { ...item, parentId, order: destinationOrder } : item) };
};
