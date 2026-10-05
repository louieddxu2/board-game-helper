import { adjustDynamicOptionCounts, collectDynamicOptionCounts, getRowHeaderColumn, readDynamicOptions, sortDynamicOptionCounts, writeDynamicOptions, type WorkspaceDynamicOptionCounts } from './model';
import { workspaceTableChangeRevision } from './changeRevisions';
import type { WorkspaceTableHistoryAction, WorkspaceTableMutation } from './history';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceDynamicOptions, WorkspaceRow, WorkspaceTable } from './types';

interface ColumnCache {
  rows: WorkspaceRow[];
  isMultiple: boolean;
  counts: WorkspaceDynamicOptionCounts;
  options?: string[];
  statistics?: WorkspaceDynamicOptions;
}

/** In-memory index for the statistics persisted on each dynamic-list column. */
export class WorkspaceDynamicOptionsCache {
  private tables = new Map<string, Map<string, ColumnCache>>();

  getOptions(table: WorkspaceTable, columnId: string): string[] {
    const cache = this.getColumnCache(table, columnId);
    return cache.options ??= sortDynamicOptionCounts(cache.counts);
  }

  private getColumnCache(table: WorkspaceTable, columnId: string): ColumnCache {
    const rowHeader = getRowHeaderColumn(table);
    const column = columnId === rowHeader.id ? rowHeader : table.columns.find(item => item.id === columnId);
    let columns = this.tables.get(table.id);
    if (!columns) { columns = new Map(); this.tables.set(table.id, columns); }
    let cache = columns.get(columnId);
    if (!cache || cache.rows !== table.rows || cache.isMultiple !== Boolean(column?.isMultiple)) {
      // A live row replacement must not reuse statistics copied from the old rows.
      const stored = cache ? undefined : column && readDynamicOptions(column, workspaceTableChangeRevision(table));
      const counts = stored ?? collectDynamicOptionCounts(table, columnId);
      cache = { rows: table.rows, isMultiple: Boolean(column?.isMultiple), counts, statistics: stored ? column?.dynamicOptions : undefined };
      columns.set(columnId, cache);
    }
    return cache;
  }

  /** Build on activation and keep immutable column snapshots for queued DB saves. */
  prepare(previous: WorkspaceData | undefined, next: WorkspaceData, mutation?: Pick<WorkspaceTableMutation, 'tableId' | 'action'>, direction: 'undo' | 'redo' = 'redo'): WorkspaceData {
    for (const after of next.tables) {
      const before = previous?.tables.find(table => table.id === after.id);
      if (!before || before === after) continue;
      for (const column of [getRowHeaderColumn(before), ...before.columns]) {
        if (column.inputType === 'dynamic-select' && column.dynamicOptions) this.getColumnCache(before, column.id);
      }
    }
    this.update(previous, next, mutation, direction);
    const tables = next.tables.map(table => {
      const sourceRevision = workspaceTableChangeRevision(table);
      const prepareColumn = (column: WorkspaceColumn): WorkspaceColumn => {
        if (column.inputType !== 'dynamic-select') return column.dynamicOptions ? { ...column, dynamicOptions: undefined } : column;
        const cache = this.getColumnCache(table, column.id);
        if (!cache.statistics) cache.statistics = writeDynamicOptions(cache.counts, sourceRevision, cache.isMultiple);
        else if (cache.statistics.sourceRevision !== sourceRevision) cache.statistics = { ...cache.statistics, sourceRevision };
        return column.dynamicOptions === cache.statistics ? column : { ...column, dynamicOptions: cache.statistics };
      };
      const rowHeader = table.rowHeader ? prepareColumn(table.rowHeader) : undefined;
      const columns = table.columns.map(prepareColumn);
      return rowHeader === table.rowHeader && columns.every((column, index) => column === table.columns[index]) ? table : { ...table, rowHeader, columns };
    });
    return tables.every((table, index) => table === next.tables[index]) ? next : { ...next, tables };
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
          columns.set(columnId, { rows: after.rows, isMultiple: cache.isMultiple, counts: collectDynamicOptionCounts(after, columnId) });
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
      cache.statistics = undefined;
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
