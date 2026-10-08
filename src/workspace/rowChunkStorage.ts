import { makeId } from './model';
import type { WorkspaceTableHistoryAction } from './history';
import type { WorkspaceColumn, WorkspaceRow, WorkspaceTable } from './types';
import { createWorkspaceRowOrderSteps, reconcileWorkspaceRowOrder, workspaceRowOrderCapacity, type StoredWorkspaceRowOrderPage, type WorkspaceRowOrderSnapshot } from './rowOrderStorage';
import { updateWorkspaceSingleRowStorage } from './singleRowStorage';
import { updateWorkspaceRowMoveStorage } from './rowMoveStorage';
import { finishWorkspaceSteps } from './workspaceCooperativeWork';

export const defaultRowChunkCapacity = 256;
export type RowChunkCapacity = 128 | 256;
export type WorkspaceTableDefinition = Omit<WorkspaceTable, 'rows' | 'updatedAt' | 'changeRevision'>;
interface StoredWorkspaceTableBase {
  definition: WorkspaceTableDefinition;
  chunkCapacity: RowChunkCapacity;
  chunkIds: string[];
}
export type StoredWorkspaceTable = StoredWorkspaceTableBase & (
  { storageFormat: 'row-chunks-v1'; rowOrder: string[] }
  | { storageFormat: 'row-chunks-v2'; orderPageIds: string[] }
);
export type CurrentStoredWorkspaceTable = Extract<StoredWorkspaceTable, { storageFormat: 'row-chunks-v2' }>;
export interface StoredWorkspaceRowChunk { tableId: string; chunkId: string; rows: WorkspaceRow[] }
export interface StoredWorkspaceTableState {
  updatedAt: number;
  changeRevision?: string;
  /** Mutable column fields, joined back into the corresponding column on load. */
  columnState?: Record<string, Pick<WorkspaceColumn, 'dynamicOptions'>>;
}
export interface WorkspaceRowLocation { chunkId: string; slot: number }
export interface WorkspaceTableStorageSnapshot {
  table: WorkspaceTable;
  record: CurrentStoredWorkspaceTable;
  order: WorkspaceRowOrderSnapshot;
  chunks: ReadonlyMap<string, StoredWorkspaceRowChunk>;
  locations: ReadonlyMap<string, WorkspaceRowLocation>;
  rowIndexes: ReadonlyMap<string, number>;
  rowOrderChange?: { beforeRows: readonly WorkspaceRow[]; from: number; to?: number };
}

export class WorkspaceStorageIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkspaceStorageIntegrityError'; }
}
const invalid = (message: string): never => { throw new WorkspaceStorageIntegrityError(message); };
const columnDefinitions = new WeakMap<WorkspaceColumn, WorkspaceColumn>();
const columnDefinition = (column: WorkspaceColumn) => {
  if (!('dynamicOptions' in column)) return column;
  let definition = columnDefinitions.get(column);
  if (!definition) {
    const { dynamicOptions: _statistics, ...rest } = column;
    definition = rest;
    columnDefinitions.set(column, definition);
  }
  return definition;
};
const definitionOf = ({ rows: _rows, updatedAt: _updatedAt, changeRevision: _revision, ...definition }: WorkspaceTable): WorkspaceTableDefinition => ({
  ...definition,
  rowHeader: definition.rowHeader ? columnDefinition(definition.rowHeader) : undefined,
  columns: definition.columns.some(column => 'dynamicOptions' in column) ? definition.columns.map(columnDefinition) : definition.columns,
});
const sameColumnDefinition = (left: WorkspaceColumn | undefined, right: WorkspaceColumn | undefined) => {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = Object.keys(left) as Array<keyof WorkspaceColumn>;
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
};
const sameDefinition = (left: WorkspaceTableDefinition, right: WorkspaceTableDefinition) =>
  left.id === right.id && left.name === right.name && left.rowHeaderName === right.rowHeaderName
  && sameColumnDefinition(left.rowHeader, right.rowHeader)
  && (left.columns === right.columns || (left.columns.length === right.columns.length && left.columns.every((column, index) => sameColumnDefinition(column, right.columns[index]))))
  && left.textScale === right.textScale && left.transposed === right.transposed;

const columnStateOf = (table: WorkspaceTable): NonNullable<StoredWorkspaceTableState['columnState']> => Object.fromEntries(
  [...(table.rowHeader ? [table.rowHeader] : []), ...table.columns].flatMap(column => column.dynamicOptions ? [[column.id, { dynamicOptions: column.dynamicOptions }]] : []),
);

export const hasCurrentWorkspaceColumnState = (table: WorkspaceTable, state?: StoredWorkspaceTableState) => {
  const current = columnStateOf(table);
  const stored = state?.columnState ?? {};
  const ids = Object.keys(current);
  return ids.length === Object.keys(stored).length && ids.every(id => current[id].dynamicOptions === stored[id]?.dynamicOptions);
};

export const isChunkedWorkspaceTable = (value: WorkspaceTable | StoredWorkspaceTable): value is StoredWorkspaceTable =>
  'storageFormat' in value && (value.storageFormat === 'row-chunks-v1' || value.storageFormat === 'row-chunks-v2');

function* restoreRowOrder(tableId: string, record: StoredWorkspaceTable, orderPages: StoredWorkspaceRowOrderPage[]): Generator<void, string[]> {
  const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && Array.from(ids).every(id => typeof id === 'string' && Boolean(id));
  if (record.storageFormat === 'row-chunks-v1') {
    if (!Array.isArray(record.rowOrder)) invalid(`Invalid row order: ${tableId}`);
    for (const [index, id] of record.rowOrder.entries()) {
      if (typeof id !== 'string' || !id) invalid(`Invalid row order: ${tableId}`);
      if (index % 128 === 127) yield;
    }
    return record.rowOrder;
  }
  const pages = new Map<string, StoredWorkspaceRowOrderPage>();
  for (const page of orderPages) {
    if (page.tableId !== tableId || !page.pageId || pages.has(page.pageId) || !validIds(page.rowIds) || !page.rowIds.length || page.rowIds.length > workspaceRowOrderCapacity) invalid(`Invalid row order page: ${tableId}`);
    pages.set(page.pageId, page);
    yield;
  }
  if (!validIds(record.orderPageIds) || new Set(record.orderPageIds).size !== record.orderPageIds.length || pages.size !== record.orderPageIds.length) invalid(`Missing or duplicate row order pages: ${tableId}`);
  const ids: string[] = [];
  for (const id of record.orderPageIds) {
    const page = pages.get(id) ?? invalid(`Missing row order page: ${tableId}`);
    ids.push(...page.rowIds);
    yield;
  }
  return ids;
}

/** Validate the complete manifest before normalization can change cell representations. */
export const assembleChunkedWorkspaceTable = (tableId: string, record: StoredWorkspaceTable, state: StoredWorkspaceTableState | undefined, chunks: StoredWorkspaceRowChunk[], orderPages: StoredWorkspaceRowOrderPage[] = []): WorkspaceTable =>
  finishWorkspaceSteps(assembleChunkedWorkspaceTableSteps(tableId, record, state, chunks, orderPages));
export function* assembleChunkedWorkspaceTableSteps(tableId: string, record: StoredWorkspaceTable, state: StoredWorkspaceTableState | undefined, chunks: StoredWorkspaceRowChunk[], orderPages: StoredWorkspaceRowOrderPage[] = []): Generator<void, WorkspaceTable> {
  if (record.definition.id !== tableId || !state || !Number.isFinite(state.updatedAt) || ![128, 256].includes(record.chunkCapacity)) return invalid(`Invalid table manifest: ${tableId}`);
  const chunkIds = new Set(record.chunkIds);
  if (chunkIds.size !== record.chunkIds.length || chunks.length !== chunkIds.size) invalid(`Missing or duplicate row chunks: ${tableId}`);
  const rows = new Map<string, WorkspaceRow>();
  for (const chunk of chunks) {
    if (chunk.tableId !== tableId || !chunkIds.delete(chunk.chunkId) || !chunk.rows.length || chunk.rows.length > record.chunkCapacity) invalid(`Invalid row chunk: ${tableId}`);
    for (const row of chunk.rows) {
      if (!row.id || rows.has(row.id)) invalid(`Duplicate row identity: ${tableId}`);
      rows.set(row.id, row);
      if (rows.size % 32 === 0) yield;
    }
  }
  const rowOrder = yield* restoreRowOrder(tableId, record, orderPages);
  if (chunkIds.size || rows.size !== rowOrder.length) invalid(`Incomplete row order: ${tableId}`);
  const seen = new Set<string>();
  const ordered: WorkspaceRow[] = [];
  for (const id of rowOrder) {
    const row = rows.get(id);
    if (!row || seen.has(id)) return invalid(`Missing or duplicate ordered row: ${tableId}`);
    seen.add(id);
    ordered.push(row);
    if (ordered.length % 128 === 0) yield;
  }
  const { columnState: storedColumnState, ...tableState } = state;
  // Derived statistics can be discarded and rebuilt without blocking table data.
  const columnState = storedColumnState && typeof storedColumnState === 'object' && !Array.isArray(storedColumnState) ? storedColumnState : undefined;
  const restoreColumn = (column: WorkspaceColumn): WorkspaceColumn => columnState === undefined ? column
    : { ...column, dynamicOptions: columnState[column.id]?.dynamicOptions };
  return {
    ...record.definition, ...tableState, rows: ordered,
    rowHeader: record.definition.rowHeader ? restoreColumn(record.definition.rowHeader) : undefined,
    columns: record.definition.columns.map(restoreColumn),
  };
}

/** Chunks and the UI share the normalized row objects, including on mixed-format reads. */
export type WorkspaceStoredTableRows = { record: StoredWorkspaceTable; chunks: StoredWorkspaceRowChunk[]; orderPages?: StoredWorkspaceRowOrderPage[] };
export const createWorkspaceTableStorageSnapshot = (table: WorkspaceTable, stored?: WorkspaceStoredTableRows, capacity: RowChunkCapacity = defaultRowChunkCapacity): WorkspaceTableStorageSnapshot =>
  finishWorkspaceSteps(createWorkspaceTableStorageSnapshotSteps(table, stored, capacity));
export function* createWorkspaceTableStorageSnapshotSteps(table: WorkspaceTable, stored?: WorkspaceStoredTableRows, capacity: RowChunkCapacity = defaultRowChunkCapacity): Generator<void, WorkspaceTableStorageSnapshot> {
  const chunks = new Map<string, StoredWorkspaceRowChunk>();
  const locations = new Map<string, WorkspaceRowLocation>();
  const rowIndexes = new Map<string, number>();
  const rowsById = new Map<string, WorkspaceRow>();
  const rowIds = !stored || stored.record.storageFormat === 'row-chunks-v1' ? [] as string[] : undefined;
  for (const [index, row] of table.rows.entries()) {
    if (!row?.id || rowsById.has(row.id)) invalid(`Duplicate row identity: ${table.id}`);
    rowsById.set(row.id, row);
    rowIndexes.set(row.id, index);
    rowIds?.push(row.id);
    if (index % 128 === 127) yield;
  }
  if (stored) {
    capacity = stored.record.chunkCapacity;
    for (const chunk of stored.chunks) {
      const rows = chunk.rows.map((row, slot) => {
        const normalized = rowsById.get(row.id);
        if (!normalized || locations.has(row.id)) return invalid(`Invalid normalized row: ${table.id}`);
        locations.set(row.id, { chunkId: chunk.chunkId, slot });
        return normalized;
      });
      chunks.set(chunk.chunkId, { tableId: table.id, chunkId: chunk.chunkId, rows });
      yield;
    }
  } else {
    for (let index = 0; index < table.rows.length; index += capacity) {
      const chunkId = makeId('chunk');
      const rows = table.rows.slice(index, index + capacity);
      rows.forEach((row, slot) => locations.set(row.id, { chunkId, slot }));
      chunks.set(chunkId, { tableId: table.id, chunkId, rows });
      yield;
    }
  }
  if (locations.size !== table.rows.length) invalid(`Incomplete normalized chunks: ${table.id}`);
  if (stored?.record.storageFormat === 'row-chunks-v2' && !stored.orderPages) invalid(`Missing row order pages: ${table.id}`);
  const order = stored?.record.storageFormat === 'row-chunks-v2'
    ? { pageIds: stored.record.orderPageIds, pages: new Map((stored.orderPages ?? []).map(page => [page.pageId, page])) }
    : yield* createWorkspaceRowOrderSteps(table.id, rowIds!);
  return {
    table, chunks, locations, rowIndexes, order,
    record: { storageFormat: 'row-chunks-v2', definition: definitionOf(table), chunkCapacity: capacity, chunkIds: stored?.record.chunkIds ?? [...chunks.keys()], orderPageIds: order.pageIds },
  };
}

const affectedCellRowIds = (action: WorkspaceTableHistoryAction | undefined) => {
  if (action?.type === 'set-cell') return [action.rowId];
  if (action?.type === 'set-cells') return [...new Set(action.changes.map(change => change.rowId))];
  if ((action?.type === 'update-column' || action?.type === 'update-row-header') && action.changes) return action.changes.map(change => change.rowId);
  if (action?.type === 'paste-range' && !action.addedRows.length && !action.addedColumns.length) return [...new Set(action.changes.map(change => change.rowId))];
  return undefined;
};

/** The fast cell path visits affected rows only. Generic/structural changes compare row references. */
export const updateWorkspaceTableStorageSnapshot = (previous: WorkspaceTableStorageSnapshot, table: WorkspaceTable, action?: WorkspaceTableHistoryAction): WorkspaceTableStorageSnapshot => {
  if (previous.table === table) return previous;
  if (previous.table.id !== table.id) return createWorkspaceTableStorageSnapshot(table);
  const candidate = definitionOf(table);
  const definition = sameDefinition(previous.record.definition, candidate) ? previous.record.definition : candidate;
  if (previous.table.rows === table.rows) return { ...previous, table, record: definition === previous.record.definition ? previous.record : { ...previous.record, definition } };
  const touched = new Map<string, WorkspaceRow[]>();
  const replaceRow = (row: WorkspaceRow, location: WorkspaceRowLocation) => {
    const chunk = previous.chunks.get(location.chunkId)!;
    if (chunk.rows[location.slot] === row) return;
    let rows = touched.get(location.chunkId);
    if (!rows) { rows = [...chunk.rows]; touched.set(location.chunkId, rows); }
    rows[location.slot] = row;
  };
  const affected = affectedCellRowIds(action);
  const sameColumnIds = previous.table.columns.length === table.columns.length && previous.table.columns.every((column, index) => column.id === table.columns[index].id);
  if (affected && previous.table.rows.length === table.rows.length && sameColumnIds) {
    for (const id of affected) {
      const index = previous.rowIndexes.get(id);
      const location = previous.locations.get(id);
      const row = index === undefined ? undefined : table.rows[index];
      if (!row || row.id !== id || !location) return invalid(`Cell mutation has invalid row: ${table.id}`);
      replaceRow(row, location);
    }
    const chunks = new Map(previous.chunks);
    for (const [chunkId, rows] of touched) chunks.set(chunkId, { tableId: table.id, chunkId, rows });
    return { ...previous, table, chunks, rowOrderChange: undefined, record: definition === previous.record.definition ? previous.record : { ...previous.record, definition } };
  }

  const singleRow = sameColumnIds ? updateWorkspaceSingleRowStorage(previous, table, action, definition) : undefined;
  if (singleRow) return singleRow;
  const movedRow = sameColumnIds ? updateWorkspaceRowMoveStorage(previous, table, action, definition) : undefined;
  if (movedRow) return movedRow;

  const seen = new Set<string>();
  const added: WorkspaceRow[] = [];
  let orderChanged = previous.table.rows.length !== table.rows.length;
  table.rows.forEach((row, index) => {
    if (!row.id || seen.has(row.id)) invalid(`Duplicate row identity: ${table.id}`);
    seen.add(row.id);
    if (previous.table.rows[index]?.id !== row.id) orderChanged = true;
    const location = previous.locations.get(row.id);
    if (location) replaceRow(row, location); else added.push(row);
  });
  const deletedChunkIds = new Set<string>();
  for (const [id, location] of previous.locations) if (!seen.has(id)) deletedChunkIds.add(location.chunkId);
  for (const chunkId of deletedChunkIds) touched.set(chunkId, (touched.get(chunkId) ?? previous.chunks.get(chunkId)!.rows).filter(row => seen.has(row.id)));

  const chunks = new Map(previous.chunks);
  for (const [chunkId, rows] of touched) {
    if (rows.length) chunks.set(chunkId, { tableId: table.id, chunkId, rows }); else chunks.delete(chunkId);
  }
  let addedIndex = 0;
  for (const [chunkId, chunk] of chunks) {
    if (addedIndex === added.length) break;
    const count = Math.min(previous.record.chunkCapacity - chunk.rows.length, added.length - addedIndex);
    if (!count) continue;
    const rows = [...chunk.rows, ...added.slice(addedIndex, addedIndex + count)];
    addedIndex += count;
    chunks.set(chunkId, { tableId: table.id, chunkId, rows });
    touched.set(chunkId, rows);
  }
  while (addedIndex < added.length) {
    const chunkId = makeId('chunk');
    const rows = added.slice(addedIndex, addedIndex + previous.record.chunkCapacity);
    addedIndex += rows.length;
    chunks.set(chunkId, { tableId: table.id, chunkId, rows });
    touched.set(chunkId, rows);
  }
  const membershipChanged = added.length > 0 || deletedChunkIds.size > 0;
  let locations = previous.locations;
  if (membershipChanged) {
    const nextLocations = new Map(previous.locations);
    for (const id of nextLocations.keys()) if (!seen.has(id)) nextLocations.delete(id);
    for (const [chunkId, rows] of touched) rows.forEach((row, slot) => nextLocations.set(row.id, { chunkId, slot }));
    locations = nextLocations;
  }
  const chunkIds = [...chunks.keys()];
  const sameChunkIds = chunkIds.length === previous.record.chunkIds.length && chunkIds.every((id, index) => id === previous.record.chunkIds[index]);
  const order = orderChanged ? reconcileWorkspaceRowOrder(previous.order, table.id, table.rows.map(row => row.id)) : previous.order;
  const record = definition === previous.record.definition && sameChunkIds && order.pageIds === previous.record.orderPageIds ? previous.record : {
    ...previous.record, definition, chunkIds: sameChunkIds ? previous.record.chunkIds : chunkIds, orderPageIds: order.pageIds,
  };
  return { table, chunks, locations, record, order, rowIndexes: orderChanged ? new Map(table.rows.map((row, index) => [row.id, index])) : previous.rowIndexes };
};

export const planWorkspaceTableStorageWrite = (snapshot: WorkspaceTableStorageSnapshot, saved?: WorkspaceTableStorageSnapshot, legacy = false, migrateOrder = false) => ({
  definition: legacy || migrateOrder || !saved || snapshot.record !== saved.record ? snapshot.record : undefined,
  upserts: [...snapshot.chunks.values()].filter(chunk => legacy || saved?.chunks.get(chunk.chunkId) !== chunk),
  deletes: legacy ? [] : [...(saved?.chunks.keys() ?? [])].filter(id => !snapshot.chunks.has(id)),
  orderUpserts: [...snapshot.order.pages.values()].filter(page => legacy || migrateOrder || saved?.order.pages.get(page.pageId) !== page),
  orderDeletes: legacy ? [] : [...(saved?.order.pages.keys() ?? [])].filter(id => !snapshot.order.pages.has(id)),
  state: { updatedAt: snapshot.table.updatedAt, changeRevision: snapshot.table.changeRevision, columnState: columnStateOf(snapshot.table) } satisfies StoredWorkspaceTableState,
});
