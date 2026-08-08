import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceNode, WorkspaceRow, WorkspaceTable } from './types';

export const makeId = (prefix: string) => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
};

export const emptyWorkspace = (): WorkspaceData => ({ version: 1, nodes: [], tables: [], activeNodeId: null });

export const createColumn = (name: string, inputType: WorkspaceInputType = 'text'): WorkspaceColumn => ({
  id: makeId('column'), name: name.trim() || '未命名欄位', inputType, options: [],
});

export const createRow = (columns: WorkspaceColumn[]): WorkspaceRow => ({
  id: makeId('row'), values: Object.fromEntries(columns.map((column) => [column.id, null])),
});

export const createTable = (name: string): WorkspaceTable => {
  const columns = [createColumn('名稱', 'text')];
  return { id: makeId('table'), name: name.trim() || '未命名表格', columns, rows: [createRow(columns)], updatedAt: Date.now() };
};

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
    const value = row.values[columnId];
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) continue;
    seen.add(value);
    options.push(value);
  }
  return options;
};

export const coerceCellValue = (column: WorkspaceColumn, raw: string): WorkspaceCellValue => {
  if (!raw.trim()) return null;
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
  const activeNodeId = data.activeNodeId && removedIds.has(data.activeNodeId) ? null : data.activeNodeId;
  return { ...data, nodes: data.nodes.filter((node) => !removedIds.has(node.id)), tables: data.tables.filter((table) => !tableIds.has(table.id)), activeNodeId };
};
