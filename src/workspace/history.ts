import { getRowHeaderColumn, makeId, sameWorkspaceCellValue } from './model';
import { applyWorkspaceCellChanges, captureWorkspaceColumnValues, removeWorkspaceColumnValues, restoreWorkspaceColumnValues } from './cellChanges';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceRow, WorkspaceTable } from './types';
import type { WorkspacePasteCellChange } from './workspacePaste';
import type { WorkspaceColumnValueChange } from './columnConversion';
import { rememberWorkspaceRowMove, rememberWorkspaceSingleRowChange } from './rowStructureChanges';

export const workspaceHistoryRetentionMs = 6 * 60 * 60 * 1000;
export const workspaceHistoryLimit = 50;

export type WorkspaceTableHistoryAction =
  | { type: 'set-cell'; rowId: string; columnId: string; before: WorkspaceCellValue; after: WorkspaceCellValue }
  | { type: 'set-cells'; columnId: string; changes: Array<{ rowId: string; before: WorkspaceCellValue; after: WorkspaceCellValue }> }
  | { type: 'paste-range'; changes: WorkspacePasteCellChange[]; addedRows: WorkspaceRow[]; addedColumns: WorkspaceColumn[] }
  | { type: 'add-row'; row: WorkspaceRow; index: number }
  | { type: 'remove-row'; row: WorkspaceRow; index: number }
  | { type: 'reorder-rows'; beforeIds: string[]; afterIds: string[] }
  | { type: 'move-row'; rowId: string; beforeIndex: number; afterIndex: number }
  | { type: 'add-column'; column: WorkspaceColumn; index: number }
  | { type: 'remove-column'; column: WorkspaceColumn; index: number; values: Record<string, WorkspaceCellValue> }
  | { type: 'reorder-columns'; beforeIds: string[]; afterIds: string[] }
  | { type: 'move-column'; columnId: string; beforeIndex: number; afterIndex: number }
  | { type: 'update-column'; before: WorkspaceColumn; after: WorkspaceColumn; changes?: WorkspaceColumnValueChange[] }
  | { type: 'update-row-header'; before?: WorkspaceColumn; after?: WorkspaceColumn; beforeName: string; afterName: string; changes?: WorkspaceColumnValueChange[] }
  | { type: 'rename-table'; before: string; after: string }
  | { type: 'set-transposed'; before: boolean; after: boolean };

export interface WorkspaceHistoryReference {
  id: string;
  label: string;
  createdAt: number;
}

export interface WorkspaceTableHistoryEntry extends WorkspaceHistoryReference {
  tableId: string;
  action: WorkspaceTableHistoryAction;
}

export interface WorkspaceTableHistory<Entry extends WorkspaceHistoryReference = WorkspaceTableHistoryEntry> {
  tableId: string;
  past: Entry[];
  future: Entry[];
}

/** A small directory may contain actions already created or read in this session. */
export type WorkspaceTableHistoryView = WorkspaceTableHistory<WorkspaceHistoryReference>;
export const isWorkspaceHistoryEntry = (entry: WorkspaceHistoryReference): entry is WorkspaceTableHistoryEntry => 'action' in entry && 'tableId' in entry;

export interface WorkspaceTableMutation {
  tableId: string;
  label: string;
  action: WorkspaceTableHistoryAction;
}

export interface WorkspaceCommitOptions {
  clearTableHistoryIds?: string[];
  clearAllHistory?: boolean;
  importedTableIds?: string[];
}

export const createEmptyWorkspaceTableHistory = (tableId: string): WorkspaceTableHistory => ({ tableId, past: [], future: [] });

export const pruneWorkspaceTableHistory = <Entry extends WorkspaceHistoryReference>(history: WorkspaceTableHistory<Entry>, now = Date.now()): WorkspaceTableHistory<Entry> => {
  const isFresh = (entry: Entry) => now - entry.createdAt <= workspaceHistoryRetentionMs;
  return {
    tableId: history.tableId,
    past: history.past.filter(isFresh).slice(-workspaceHistoryLimit),
    future: history.future.filter(isFresh).slice(-workspaceHistoryLimit),
  };
};

/** Edits made while disk history loads take precedence, including imports and deletions. */
export const hydrateWorkspaceHistories = <Entry extends WorkspaceHistoryReference>(
  stored: Map<string, WorkspaceTableHistory<Entry>>,
  pending: Map<string, WorkspaceTableHistory<Entry>>,
  tableIds: Set<string>,
  reset: { all: boolean; ids: Set<string> },
) => {
  const merged = new Map<string, WorkspaceTableHistory<Entry>>();
  for (const tableId of tableIds) {
    const previous = reset.all || reset.ids.has(tableId) ? undefined : stored.get(tableId);
    const current = pending.get(tableId);
    if (current) merged.set(tableId, pruneWorkspaceTableHistory({
      ...current,
      // The disk read may already contain an early edit that was queued before it.
      past: [...new Map([...(previous?.past ?? []), ...current.past].map((entry) => [entry.id, entry])).values()],
    }));
    else if (previous) merged.set(tableId, previous);
  }
  return merged;
};

const columnConfiguration = (column: WorkspaceColumn | undefined) => {
  if (!column || !('dynamicOptions' in column)) return column;
  const { dynamicOptions: _statistics, ...configuration } = column;
  return configuration;
};

/** Statistics follow the current rows; history retains settings and any converted values. */
const historyAction = (action: WorkspaceTableHistoryAction): WorkspaceTableHistoryAction => {
  switch (action.type) {
    case 'update-column': return { ...action, before: columnConfiguration(action.before)!, after: columnConfiguration(action.after)! };
    case 'update-row-header': return { ...action, before: columnConfiguration(action.before), after: columnConfiguration(action.after) };
    case 'add-column':
    case 'remove-column': return { ...action, column: columnConfiguration(action.column)! };
    case 'paste-range': return { ...action, addedColumns: action.addedColumns.map(column => columnConfiguration(column)!) };
    default: return action;
  }
};

export const pushWorkspaceTableHistory = <Entry extends WorkspaceHistoryReference>(history: WorkspaceTableHistory<Entry>, mutation: WorkspaceTableMutation, now = Date.now()) => pruneWorkspaceTableHistory({
  tableId: mutation.tableId,
  past: [...history.past, { id: makeId('history'), tableId: mutation.tableId, label: mutation.label, createdAt: now, action: historyAction(mutation.action) }],
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

const insertById = <Item extends { id: string }>(items: Item[], item: Item, index: number) => {
  const next = items.filter(current => current.id !== item.id);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
};

const moveById = <Item extends { id: string }>(items: Item[], id: string, index: number) => {
  const from = items.findIndex(item => item.id === id);
  if (from < 0 || !Number.isSafeInteger(index)) return items;
  const to = Math.max(0, Math.min(index, items.length - 1));
  if (from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const appendMissing = <Item extends { id: string }>(items: Item[], additions: Item[]) => {
  if (!additions.length) return items;
  const ids = new Set(items.map(item => item.id));
  return [...items, ...additions.filter(item => !ids.has(item.id))];
};

export const applyWorkspaceTableHistoryAction = (
  data: WorkspaceData,
  tableId: string,
  action: WorkspaceTableHistoryAction,
  direction: 'undo' | 'redo',
) => {
  const forward = direction === 'redo';
  const side = forward ? 'after' : 'before';
  return updateHistoryTable(data, tableId, (current) => {
    const rowHeaderId = getRowHeaderColumn(current).id;
    switch (action.type) {
      case 'set-cell':
        return tableWithUpdatedAt({
          ...current,
          rows: applyWorkspaceCellChanges(current.rows, rowHeaderId, [action], side),
        });
      case 'set-cells':
        return tableWithUpdatedAt({
          ...current,
          rows: applyWorkspaceCellChanges(current.rows, undefined, action.changes.map(change => ({ ...change, columnId: action.columnId })), side),
        });
      case 'paste-range': {
        const addedRowIds = new Set(action.addedRows.map((row) => row.id));
        const addedColumnIds = new Set(action.addedColumns.map((column) => column.id));
        const baseRows = forward ? appendMissing(current.rows, action.addedRows) : current.rows;
        const baseColumns = forward ? appendMissing(current.columns, action.addedColumns) : current.columns;
        const changedRows = applyWorkspaceCellChanges(baseRows, rowHeaderId, action.changes, side);
        return tableWithUpdatedAt({
          ...current,
          columns: forward || !addedColumnIds.size ? baseColumns : baseColumns.filter((column) => !addedColumnIds.has(column.id)),
          rows: forward ? changedRows : removeWorkspaceColumnValues(
            addedRowIds.size ? changedRows.filter(row => !addedRowIds.has(row.id)) : changedRows, addedColumnIds,
          ),
        });
      }
      case 'add-row':
      case 'remove-row': {
        const adding = (action.type === 'add-row') === forward;
        const rows = adding ? insertById(current.rows, action.row, action.index) : current.rows.filter(row => row.id !== action.row.id);
        const index = adding ? Math.max(0, Math.min(action.index, rows.length - 1)) : action.index;
        rememberWorkspaceSingleRowChange(current.rows, rows, action.row.id, index);
        return tableWithUpdatedAt({ ...current, rows });
      }
      case 'reorder-rows':
        return tableWithUpdatedAt({ ...current, rows: reorderByIds(current.rows, forward ? action.afterIds : action.beforeIds) });
      case 'move-row': {
        const index = forward ? action.afterIndex : action.beforeIndex;
        const rows = moveById(current.rows, action.rowId, index);
        rememberWorkspaceRowMove(current.rows, rows, action.rowId, current.rows.findIndex(row => row.id === action.rowId), Math.max(0, Math.min(index, rows.length - 1)));
        return tableWithUpdatedAt({ ...current, rows });
      }
      case 'add-column':
        return tableWithUpdatedAt({
          ...current,
          columns: forward ? insertById(current.columns, action.column, action.index) : current.columns.filter((column) => column.id !== action.column.id),
          rows: forward ? current.rows : removeWorkspaceColumnValues(current.rows, new Set([action.column.id])),
        });
      case 'remove-column':
        return tableWithUpdatedAt({
          ...current,
          columns: forward ? current.columns.filter((column) => column.id !== action.column.id) : insertById(current.columns, action.column, action.index),
          rows: forward ? removeWorkspaceColumnValues(current.rows, new Set([action.column.id]))
            : restoreWorkspaceColumnValues(current.rows, action.column.id, action.values),
        });
      case 'reorder-columns':
        return tableWithUpdatedAt({ ...current, columns: reorderByIds(current.columns, forward ? action.afterIds : action.beforeIds) });
      case 'move-column':
        return tableWithUpdatedAt({ ...current, columns: moveById(current.columns, action.columnId, forward ? action.afterIndex : action.beforeIndex) });
      case 'update-column':
      case 'update-row-header':
        return tableWithUpdatedAt({
          ...current,
          ...(action.type === 'update-column'
            ? { columns: current.columns.map(column => column.id === action.after.id ? (forward ? action.after : action.before) : column) }
            : { rowHeader: forward ? action.after : action.before, rowHeaderName: forward ? action.afterName : action.beforeName }),
          rows: applyWorkspaceCellChanges(current.rows, rowHeaderId,
            (action.changes ?? []).map(change => ({ ...change, columnId: action.type === 'update-row-header' ? rowHeaderId : action.after.id })), side),
        });
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

const same = (left: unknown, right: unknown) => left === right || JSON.stringify(left) === JSON.stringify(right);
const sameColumn = (left: WorkspaceColumn | undefined, right: WorkspaceColumn | undefined) => left === right || same(columnConfiguration(left), columnConfiguration(right));
const sameRows = (left: WorkspaceTable, right: WorkspaceTable) => left.rows === right.rows || (left.rows.length === right.rows.length && left.rows.every((row, index) => same(row, right.rows[index])));
const sameColumns = (left: WorkspaceTable, right: WorkspaceTable) => left.columns === right.columns || (left.columns.length === right.columns.length && left.columns.every((column, index) => sameColumn(column, right.columns[index])));
const sameTableContent = (left: WorkspaceTable, right: WorkspaceTable, ignoreTextScale = false) => {
  if (left === right) return true;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as Array<keyof WorkspaceTable>);
  keys.delete('updatedAt'); keys.delete('changeRevision');
  if (ignoreTextScale) keys.delete('textScale');
  return [...keys].every(key => key === 'rows' ? sameRows(left, right) : key === 'columns' ? sameColumns(left, right) : key === 'rowHeader' ? sameColumn(left.rowHeader, right.rowHeader) : same(left[key], right[key]));
};

export const inferWorkspaceTableMutation = (before: WorkspaceData, after: WorkspaceData): WorkspaceTableMutation | undefined => {
  const changed = after.tables.filter((nextTable) => {
    const previous = before.tables.find((table) => table.id === nextTable.id);
    return previous && !sameTableContent(previous, nextTable, true);
  });
  if (changed.length !== 1) return undefined;
  const nextTable = changed[0];
  const beforeTable = before.tables.find((table) => table.id === nextTable.id);
  if (!beforeTable) return undefined;
  const tableId = nextTable.id;
  const mutation = (label: string, action: WorkspaceTableHistoryAction): WorkspaceTableMutation => ({ tableId, label, action: historyAction(action) });

  if (beforeTable.transposed !== nextTable.transposed && sameTableContent(beforeTable, { ...nextTable, transposed: beforeTable.transposed })) {
    return mutation('切換表格方向', { type: 'set-transposed', before: Boolean(beforeTable.transposed), after: Boolean(nextTable.transposed) });
  }
  if (beforeTable.name !== nextTable.name && sameTableContent({ ...beforeTable, name: nextTable.name }, nextTable)) {
    return mutation('重新命名表格', { type: 'rename-table', before: beforeTable.name, after: nextTable.name });
  }
  if ((beforeTable.rowHeaderName !== nextTable.rowHeaderName || !sameColumn(beforeTable.rowHeader, nextTable.rowHeader)) && sameRows(beforeTable, nextTable) && sameColumns(beforeTable, nextTable)) {
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
    if (column) return mutation('刪除屬性', { type: 'remove-column', column, index: beforeColumnIds.indexOf(column.id), values: captureWorkspaceColumnValues(beforeTable.rows, column.id) });
  }
  if (addedColumnIds.length === 0 && removedColumnIds.length === 0 && !same(beforeColumnIds, nextColumnIds) && sameRows(beforeTable, nextTable)) {
    return mutation('重新排列屬性', { type: 'reorder-columns', beforeIds: beforeColumnIds, afterIds: nextColumnIds });
  }
  if (same(beforeColumnIds, nextColumnIds)) {
    const changedColumns = beforeTable.columns.filter((column, index) => !sameColumn(column, nextTable.columns[index]));
    if (changedColumns.length === 1 && sameRows(beforeTable, nextTable)) {
      const beforeColumn = changedColumns[0];
      const afterColumn = nextTable.columns.find((column) => column.id === beforeColumn.id);
      if (afterColumn) return mutation('設定屬性', { type: 'update-column', before: beforeColumn, after: afterColumn });
    }
  }

  const beforeRowIds = beforeTable.rows.map((row) => row.id);
  const nextRowIds = nextTable.rows.map((row) => row.id);
  const beforeRowIdSet = new Set(beforeRowIds);
  const nextRowIdSet = new Set(nextRowIds);
  const addedRowIds = nextRowIds.filter((id) => !beforeRowIdSet.has(id));
  const removedRowIds = beforeRowIds.filter((id) => !nextRowIdSet.has(id));
  if (addedRowIds.length === 1 && removedRowIds.length === 0 && sameColumns(beforeTable, nextTable)) {
    const row = nextTable.rows.find((item) => item.id === addedRowIds[0]);
    const index = row ? nextRowIds.indexOf(row.id) : -1;
    if (row && beforeTable.rows.every((item, position) => same(item, nextTable.rows[position < index ? position : position + 1]))) return mutation('新增物件', { type: 'add-row', row, index });
  }
  if (removedRowIds.length === 1 && addedRowIds.length === 0 && sameColumns(beforeTable, nextTable)) {
    const row = beforeTable.rows.find((item) => item.id === removedRowIds[0]);
    const index = row ? beforeRowIds.indexOf(row.id) : -1;
    if (row && nextTable.rows.every((item, position) => same(item, beforeTable.rows[position < index ? position : position + 1]))) return mutation('刪除物件', { type: 'remove-row', row, index });
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
      if (!sameWorkspaceCellValue(beforeRow.name, afterRow.name)) changedValues.add(getRowHeaderColumn(beforeTable).id);
      for (const column of beforeTable.columns) if (!sameWorkspaceCellValue(beforeRow.values[column.id] ?? null, afterRow.values[column.id] ?? null)) changedValues.add(column.id);
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
