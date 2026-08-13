import { getRowHeaderColumn } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceRow, WorkspaceTable } from './types';

export const workspaceHistoryRetentionMs = 6 * 60 * 60 * 1000;
export const workspaceHistoryLimit = 50;

export type WorkspaceTableHistoryAction =
  | { type: 'set-cell'; rowId: string; columnId: string; before: WorkspaceCellValue; after: WorkspaceCellValue }
  | { type: 'set-cells'; columnId: string; changes: Array<{ rowId: string; before: WorkspaceCellValue; after: WorkspaceCellValue }> }
  | { type: 'add-row'; row: WorkspaceRow; index: number }
  | { type: 'remove-row'; row: WorkspaceRow; index: number }
  | { type: 'reorder-rows'; beforeIds: string[]; afterIds: string[] }
  | { type: 'add-column'; column: WorkspaceColumn; index: number }
  | { type: 'remove-column'; column: WorkspaceColumn; index: number; values: Record<string, WorkspaceCellValue> }
  | { type: 'reorder-columns'; beforeIds: string[]; afterIds: string[] }
  | { type: 'update-column'; before: WorkspaceColumn; after: WorkspaceColumn }
  | { type: 'update-row-header'; before?: WorkspaceColumn; after?: WorkspaceColumn; beforeName: string; afterName: string }
  | { type: 'rename-table'; before: string; after: string }
  | { type: 'set-transposed'; before: boolean; after: boolean };

export interface WorkspaceTableHistoryEntry {
  id: string;
  tableId: string;
  label: string;
  createdAt: number;
  action: WorkspaceTableHistoryAction;
}

export interface WorkspaceTableHistory {
  tableId: string;
  past: WorkspaceTableHistoryEntry[];
  future: WorkspaceTableHistoryEntry[];
}

export interface WorkspaceTableMutation {
  tableId: string;
  label: string;
  action: WorkspaceTableHistoryAction;
}

export interface WorkspaceCommitOptions {
  clearTableHistoryIds?: string[];
  clearAllHistory?: boolean;
}

export const createEmptyWorkspaceTableHistory = (tableId: string): WorkspaceTableHistory => ({ tableId, past: [], future: [] });

export const pruneWorkspaceTableHistory = (history: WorkspaceTableHistory, now = Date.now()): WorkspaceTableHistory => {
  const isFresh = (entry: WorkspaceTableHistoryEntry) => now - entry.createdAt <= workspaceHistoryRetentionMs;
  return {
    tableId: history.tableId,
    past: history.past.filter(isFresh).slice(-workspaceHistoryLimit),
    future: history.future.filter(isFresh).slice(-workspaceHistoryLimit),
  };
};

const historyEntryId = () => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `history-${random}`;
};

export const pushWorkspaceTableHistory = (history: WorkspaceTableHistory, mutation: WorkspaceTableMutation, now = Date.now()) => pruneWorkspaceTableHistory({
  tableId: mutation.tableId,
  past: [...history.past, { id: historyEntryId(), tableId: mutation.tableId, label: mutation.label, createdAt: now, action: mutation.action }],
  future: [],
}, now);

const tableWithUpdatedAt = (table: WorkspaceTable) => ({ ...table, updatedAt: Date.now() });
const updateHistoryTable = (data: WorkspaceData, tableId: string, updater: (table: WorkspaceTable) => WorkspaceTable): WorkspaceData => ({
  ...data,
  tables: data.tables.map((table) => table.id === tableId ? updater(table) : table),
});

const reorderByIds = <Item extends { id: string }>(items: Item[], ids: string[]) => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = ids.flatMap((id) => {
    const item = byId.get(id);
    if (!item) return [];
    byId.delete(id);
    return [item];
  });
  return [...ordered, ...byId.values()];
};

const insertAt = <Item>(items: Item[], item: Item, index: number) => {
  const next = items.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
};

export const applyWorkspaceTableHistoryAction = (
  data: WorkspaceData,
  tableId: string,
  action: WorkspaceTableHistoryAction,
  direction: 'undo' | 'redo',
) => {
  const forward = direction === 'redo';
  return updateHistoryTable(data, tableId, (current) => {
    switch (action.type) {
      case 'set-cell':
        return tableWithUpdatedAt({
          ...current,
          rows: current.rows.map((row) => row.id !== action.rowId ? row : action.columnId === getRowHeaderColumn(current).id
            ? { ...row, name: forward ? action.after : action.before }
            : { ...row, values: { ...row.values, [action.columnId]: forward ? action.after : action.before } }),
        });
      case 'set-cells': {
        const changes = new Map(action.changes.map((change) => [change.rowId, change]));
        return tableWithUpdatedAt({
          ...current,
          rows: current.rows.map((row) => {
            const change = changes.get(row.id);
            if (!change) return row;
            return { ...row, values: { ...row.values, [action.columnId]: forward ? change.after : change.before } };
          }),
        });
      }
      case 'add-row':
        return tableWithUpdatedAt({ ...current, rows: forward ? insertAt(current.rows.filter((row) => row.id !== action.row.id), action.row, action.index) : current.rows.filter((row) => row.id !== action.row.id) });
      case 'remove-row':
        return tableWithUpdatedAt({ ...current, rows: forward ? current.rows.filter((row) => row.id !== action.row.id) : insertAt(current.rows.filter((row) => row.id !== action.row.id), action.row, action.index) });
      case 'reorder-rows':
        return tableWithUpdatedAt({ ...current, rows: reorderByIds(current.rows, forward ? action.afterIds : action.beforeIds) });
      case 'add-column':
        return tableWithUpdatedAt({
          ...current,
          columns: forward ? insertAt(current.columns.filter((column) => column.id !== action.column.id), action.column, action.index) : current.columns.filter((column) => column.id !== action.column.id),
          rows: current.rows.map((row) => {
            const values = { ...row.values };
            if (forward) values[action.column.id] ??= null;
            else delete values[action.column.id];
            return { ...row, values };
          }),
        });
      case 'remove-column':
        return tableWithUpdatedAt({
          ...current,
          columns: forward ? current.columns.filter((column) => column.id !== action.column.id) : insertAt(current.columns.filter((column) => column.id !== action.column.id), action.column, action.index),
          rows: current.rows.map((row) => {
            const values = { ...row.values };
            if (forward) delete values[action.column.id];
            else values[action.column.id] = action.values[row.id] ?? null;
            return { ...row, values };
          }),
        });
      case 'reorder-columns':
        return tableWithUpdatedAt({ ...current, columns: reorderByIds(current.columns, forward ? action.afterIds : action.beforeIds) });
      case 'update-column':
        return tableWithUpdatedAt({ ...current, columns: current.columns.map((column) => column.id === action.after.id ? (forward ? action.after : action.before) : column) });
      case 'update-row-header':
        return tableWithUpdatedAt({ ...current, rowHeader: forward ? action.after : action.before, rowHeaderName: forward ? action.afterName : action.beforeName });
      case 'rename-table':
        return tableWithUpdatedAt({ ...current, name: forward ? action.after : action.before });
      case 'set-transposed':
        return tableWithUpdatedAt({ ...current, transposed: forward ? action.after : action.before });
    }
  });
};

export const updateTableNodeName = (data: WorkspaceData, tableId: string, name: string) => ({
  ...data,
  nodes: data.nodes.map((node) => node.tableId === tableId ? { ...node, name } : node),
});

export const applyWorkspaceTableHistoryActionWithNode = (
  data: WorkspaceData,
  tableId: string,
  action: WorkspaceTableHistoryAction,
  direction: 'undo' | 'redo',
) => {
  const next = applyWorkspaceTableHistoryAction(data, tableId, action, direction);
  if (action.type !== 'rename-table') return next;
  return updateTableNodeName(next, tableId, direction === 'redo' ? action.after : action.before);
};

const tableWithout = (table: WorkspaceTable, keys: Array<'updatedAt' | 'textScale'>) => {
  const copy = { ...table } as Partial<WorkspaceTable>;
  for (const key of keys) delete copy[key];
  return copy;
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const sameRows = (left: WorkspaceTable, right: WorkspaceTable) => same(left.rows, right.rows);
const sameColumns = (left: WorkspaceTable, right: WorkspaceTable) => same(left.columns, right.columns);

export const inferWorkspaceTableMutation = (before: WorkspaceData, after: WorkspaceData): WorkspaceTableMutation | undefined => {
  const changed = after.tables.filter((nextTable) => {
    const previous = before.tables.find((table) => table.id === nextTable.id);
    return previous && !same(tableWithout(previous, ['updatedAt']), tableWithout(nextTable, ['updatedAt'])) && !same(tableWithout(previous, ['updatedAt', 'textScale']), tableWithout(nextTable, ['updatedAt', 'textScale']));
  });
  if (changed.length !== 1) return undefined;
  const nextTable = changed[0];
  const beforeTable = before.tables.find((table) => table.id === nextTable.id);
  if (!beforeTable) return undefined;
  const tableId = nextTable.id;
  const mutation = (label: string, action: WorkspaceTableHistoryAction): WorkspaceTableMutation => ({ tableId, label, action });

  if (beforeTable.textScale !== nextTable.textScale && same(tableWithout(beforeTable, ['updatedAt', 'textScale']), tableWithout(nextTable, ['updatedAt', 'textScale']))) return undefined;
  if (beforeTable.transposed !== nextTable.transposed && same(tableWithout(beforeTable, ['updatedAt']), { ...tableWithout(nextTable, ['updatedAt']), transposed: beforeTable.transposed })) {
    return mutation('切換表格方向', { type: 'set-transposed', before: Boolean(beforeTable.transposed), after: Boolean(nextTable.transposed) });
  }
  if (beforeTable.name !== nextTable.name && same({ ...tableWithout(beforeTable, ['updatedAt']), name: nextTable.name }, tableWithout(nextTable, ['updatedAt']))) {
    return mutation('重新命名表格', { type: 'rename-table', before: beforeTable.name, after: nextTable.name });
  }
  if ((beforeTable.rowHeaderName !== nextTable.rowHeaderName || !same(beforeTable.rowHeader, nextTable.rowHeader)) && sameRows(beforeTable, nextTable) && sameColumns(beforeTable, nextTable)) {
    return mutation('設定物件屬性', { type: 'update-row-header', before: beforeTable.rowHeader, after: nextTable.rowHeader, beforeName: beforeTable.rowHeaderName, afterName: nextTable.rowHeaderName });
  }

  const beforeColumnIds = beforeTable.columns.map((column) => column.id);
  const nextColumnIds = nextTable.columns.map((column) => column.id);
  const addedColumnIds = nextColumnIds.filter((id) => !beforeColumnIds.includes(id));
  const removedColumnIds = beforeColumnIds.filter((id) => !nextColumnIds.includes(id));
  if (addedColumnIds.length === 1 && removedColumnIds.length === 0) {
    const column = nextTable.columns.find((item) => item.id === addedColumnIds[0]);
    if (column) return mutation('新增屬性', { type: 'add-column', column, index: nextColumnIds.indexOf(column.id) });
  }
  if (removedColumnIds.length === 1 && addedColumnIds.length === 0) {
    const column = beforeTable.columns.find((item) => item.id === removedColumnIds[0]);
    if (column) return mutation('刪除屬性', { type: 'remove-column', column, index: beforeColumnIds.indexOf(column.id), values: Object.fromEntries(beforeTable.rows.map((row) => [row.id, row.values[column.id] ?? null])) });
  }
  if (addedColumnIds.length === 0 && removedColumnIds.length === 0 && !same(beforeColumnIds, nextColumnIds) && sameRows(beforeTable, nextTable)) {
    return mutation('重新排列屬性', { type: 'reorder-columns', beforeIds: beforeColumnIds, afterIds: nextColumnIds });
  }
  if (same(beforeColumnIds, nextColumnIds)) {
    const changedColumns = beforeTable.columns.filter((column, index) => !same(column, nextTable.columns[index]));
    if (changedColumns.length === 1 && sameRows(beforeTable, nextTable)) {
      const beforeColumn = changedColumns[0];
      const afterColumn = nextTable.columns.find((column) => column.id === beforeColumn.id);
      if (afterColumn) return mutation('設定屬性', { type: 'update-column', before: beforeColumn, after: afterColumn });
    }
  }

  const beforeRowIds = beforeTable.rows.map((row) => row.id);
  const nextRowIds = nextTable.rows.map((row) => row.id);
  const addedRowIds = nextRowIds.filter((id) => !beforeRowIds.includes(id));
  const removedRowIds = beforeRowIds.filter((id) => !nextRowIds.includes(id));
  if (addedRowIds.length === 1 && removedRowIds.length === 0 && sameColumns(beforeTable, nextTable)) {
    const row = nextTable.rows.find((item) => item.id === addedRowIds[0]);
    if (row) return mutation('新增物件', { type: 'add-row', row, index: nextRowIds.indexOf(row.id) });
  }
  if (removedRowIds.length === 1 && addedRowIds.length === 0 && sameColumns(beforeTable, nextTable)) {
    const row = beforeTable.rows.find((item) => item.id === removedRowIds[0]);
    if (row) return mutation('刪除物件', { type: 'remove-row', row, index: beforeRowIds.indexOf(row.id) });
  }
  if (addedRowIds.length === 0 && removedRowIds.length === 0 && !same(beforeRowIds, nextRowIds) && sameColumns(beforeTable, nextTable)) {
    return mutation('重新排列物件', { type: 'reorder-rows', beforeIds: beforeRowIds, afterIds: nextRowIds });
  }
  if (same(beforeRowIds, nextRowIds) && sameColumns(beforeTable, nextTable)) {
    const changedRows = beforeTable.rows.filter((row, index) => !same(row, nextTable.rows[index]));
    if (changedRows.length === 1) {
      const beforeRow = changedRows[0];
      const afterRow = nextTable.rows.find((row) => row.id === beforeRow.id);
      if (!afterRow) return undefined;
      const changedValues = new Set<string>();
      if (!same(beforeRow.name, afterRow.name)) changedValues.add(getRowHeaderColumn(beforeTable).id);
      for (const column of beforeTable.columns) if (!same(beforeRow.values[column.id] ?? null, afterRow.values[column.id] ?? null)) changedValues.add(column.id);
      if (changedValues.size === 1) {
        const columnId = [...changedValues][0];
        const beforeValue = columnId === getRowHeaderColumn(beforeTable).id ? beforeRow.name : beforeRow.values[columnId] ?? null;
        const afterValue = columnId === getRowHeaderColumn(beforeTable).id ? afterRow.name : afterRow.values[columnId] ?? null;
        return mutation(columnId === getRowHeaderColumn(beforeTable).id ? '編輯物件' : '編輯儲存格', { type: 'set-cell', rowId: beforeRow.id, columnId, before: beforeValue, after: afterValue });
      }
    }
  }
  return undefined;
};
