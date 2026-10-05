import { adjustDynamicOptionCounts, getRowHeaderColumn, sortDynamicOptionCounts, type WorkspaceDynamicOptionCounts } from './model';
import type { WorkspaceTableHistoryAction, WorkspaceTableMutation } from './history';
import type { WorkspaceCellValue, WorkspaceData, WorkspaceRow, WorkspaceTable } from './types';

interface ColumnCache {
  rows: WorkspaceRow[];
  isMultiple: boolean;
  counts: WorkspaceDynamicOptionCounts;
  options?: string[];
}

/** Derived session data only: never changes table revisions or export content. */
export class WorkspaceDynamicOptionsCache {
  private tables = new Map<string, Map<string, ColumnCache>>();

  getOptions(table: WorkspaceTable, columnId: string): string[] {
    const rowHeader = getRowHeaderColumn(table);
    const column = columnId === rowHeader.id ? rowHeader : table.columns.find(item => item.id === columnId);
    let columns = this.tables.get(table.id);
    if (!columns) { columns = new Map(); this.tables.set(table.id, columns); }
    let cache = columns.get(columnId);
    if (!cache || cache.rows !== table.rows || cache.isMultiple !== Boolean(column?.isMultiple)) {
      const counts: WorkspaceDynamicOptionCounts = new Map();
      for (const row of table.rows) {
        adjustDynamicOptionCounts(counts, columnId === rowHeader.id ? row.name : row.values[columnId], column?.isMultiple, 1);
      }
      cache = { rows: table.rows, isMultiple: Boolean(column?.isMultiple), counts };
      columns.set(columnId, cache);
    }
    return cache.options ??= sortDynamicOptionCounts(cache.counts);
  }

  update(previous: WorkspaceData | undefined, next: WorkspaceData, mutation?: Pick<WorkspaceTableMutation, 'tableId' | 'action'>, direction: 'undo' | 'redo' = 'redo') {
    const nextTables = new Map(next.tables.map(table => [table.id, table]));
    for (const [tableId, columns] of this.tables) {
      const after = nextTables.get(tableId);
      const before = previous?.tables.find(table => table.id === tableId);
      if (!after || !before) { this.tables.delete(tableId); continue; }
      if (before === after) continue;
      const rowHeader = getRowHeaderColumn(after);
      const action = mutation?.tableId === tableId ? mutation.action : undefined;
      for (const [columnId, cache] of columns) {
        const column = columnId === rowHeader.id ? rowHeader : after.columns.find(item => item.id === columnId);
        if (column?.inputType !== 'dynamic-select' || cache.isMultiple !== Boolean(column.isMultiple) || cache.rows !== before.rows) {
          columns.delete(columnId);
          continue;
        }
        if (before.rows !== after.rows && (!action || !this.applyAction(cache, columnId, rowHeader.id, action, direction))) {
          columns.delete(columnId);
          continue;
        }
        cache.rows = after.rows;
      }
      if (!columns.size) this.tables.delete(tableId);
    }
  }

  private applyAction(cache: ColumnCache, columnId: string, rowHeaderId: string, action: WorkspaceTableHistoryAction, direction: 'undo' | 'redo') {
    const sign = direction === 'redo' ? 1 : -1;
    const adjust = (value: WorkspaceCellValue, delta: 1 | -1) => {
      cache.options = undefined;
      return adjustDynamicOptionCounts(cache.counts, value, cache.isMultiple, delta);
    };
    const change = (before: WorkspaceCellValue, after: WorkspaceCellValue) =>
      adjust(direction === 'redo' ? before : after, -1) && adjust(direction === 'redo' ? after : before, 1);
    const rowValue = (row: WorkspaceRow) => columnId === rowHeaderId ? row.name : row.values[columnId] ?? null;
    switch (action.type) {
      case 'set-cell':
        return action.columnId !== columnId || change(action.before, action.after);
      case 'set-cells':
        return action.columnId !== columnId || action.changes.every(item => change(item.before, item.after));
      case 'paste-range': {
        // New rows already contain their pasted values; don't count their changes twice.
        const added = new Set(action.addedRows.map(row => row.id));
        return action.changes.every(item => item.columnId !== columnId || added.has(item.rowId) || change(item.before, item.after))
          && action.addedRows.every(row => adjust(rowValue(row), sign));
      }
      case 'add-row':
        return adjust(rowValue(action.row), sign);
      case 'remove-row':
        return adjust(rowValue(action.row), sign === 1 ? -1 : 1);
      case 'reorder-rows':
      case 'add-column':
      case 'remove-column':
      case 'reorder-columns':
      case 'update-column':
      case 'update-row-header':
      case 'rename-table':
      case 'set-transposed':
        return true;
    }
  }
}
