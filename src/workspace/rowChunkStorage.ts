import { makeId } from './model';
import type { WorkspaceTableHistoryAction } from './history';
import type { WorkspaceRow, WorkspaceTable } from './types';

export const defaultRowChunkCapacity = 256;
export type RowChunkCapacity = 128 | 256;
export type WorkspaceTableDefinition = Omit<WorkspaceTable, 'rows' | 'updatedAt' | 'changeRevision'>;
export interface StoredWorkspaceTable {
  storageFormat: 'row-chunks-v1';
  definition: WorkspaceTableDefinition;
  chunkCapacity: RowChunkCapacity;
  chunkIds: string[];
  rowOrder: string[];
}
export interface StoredWorkspaceRowChunk { tableId: string; chunkId: string; rows: WorkspaceRow[] }
export interface StoredWorkspaceTableState { updatedAt: number; changeRevision?: string }
export interface WorkspaceRowLocation { chunkId: string; slot: number }
export interface WorkspaceTableStorageSnapshot {
  table: WorkspaceTable;
  record: StoredWorkspaceTable;
  chunks: ReadonlyMap<string, StoredWorkspaceRowChunk>;
  locations: ReadonlyMap<string, WorkspaceRowLocation>;
  rowIndexes: ReadonlyMap<string, number>;
}

export class WorkspaceStorageIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkspaceStorageIntegrityError'; }
}
const invalid = (message: string): never => { throw new WorkspaceStorageIntegrityError(message); };
const definitionOf = ({ rows: _rows, updatedAt: _updatedAt, changeRevision: _revision, ...definition }: WorkspaceTable): WorkspaceTableDefinition => definition;
const sameDefinition = (left: WorkspaceTableDefinition, right: WorkspaceTableDefinition) =>
  left.id === right.id && left.name === right.name && left.rowHeaderName === right.rowHeaderName
  && left.rowHeader === right.rowHeader && left.columns === right.columns
  && left.textScale === right.textScale && left.transposed === right.transposed;

export const isChunkedWorkspaceTable = (value: WorkspaceTable | StoredWorkspaceTable): value is StoredWorkspaceTable =>
  'storageFormat' in value && value.storageFormat === 'row-chunks-v1';

/** Validate the complete manifest before normalization can change cell representations. */
export const assembleChunkedWorkspaceTable = (tableId: string, record: StoredWorkspaceTable, state: StoredWorkspaceTableState | undefined, chunks: StoredWorkspaceRowChunk[]): WorkspaceTable => {
  if (record.definition.id !== tableId || !state || !Number.isFinite(state.updatedAt) || ![128, 256].includes(record.chunkCapacity)) return invalid(`Invalid table manifest: ${tableId}`);
  const chunkIds = new Set(record.chunkIds);
  if (chunkIds.size !== record.chunkIds.length || chunks.length !== chunkIds.size) invalid(`Missing or duplicate row chunks: ${tableId}`);
  const rows = new Map<string, WorkspaceRow>();
  for (const chunk of chunks) {
    if (chunk.tableId !== tableId || !chunkIds.delete(chunk.chunkId) || !chunk.rows.length || chunk.rows.length > record.chunkCapacity) invalid(`Invalid row chunk: ${tableId}`);
    for (const row of chunk.rows) {
      if (!row.id || rows.has(row.id)) invalid(`Duplicate row identity: ${tableId}`);
      rows.set(row.id, row);
    }
  }
  if (chunkIds.size || rows.size !== record.rowOrder.length) invalid(`Incomplete row order: ${tableId}`);
  const seen = new Set<string>();
  const ordered = record.rowOrder.map(id => {
    const row = rows.get(id);
    if (!row || seen.has(id)) return invalid(`Missing or duplicate ordered row: ${tableId}`);
    seen.add(id);
    return row;
  });
  return { ...record.definition, ...state, rows: ordered };
};

/** Chunks and the UI share the normalized row objects, including on mixed-format reads. */
export const createWorkspaceTableStorageSnapshot = (table: WorkspaceTable, stored?: { record: StoredWorkspaceTable; chunks: StoredWorkspaceRowChunk[] }, capacity: RowChunkCapacity = defaultRowChunkCapacity): WorkspaceTableStorageSnapshot => {
  const chunks = new Map<string, StoredWorkspaceRowChunk>();
  const locations = new Map<string, WorkspaceRowLocation>();
  const rowIndexes = new Map<string, number>();
  const rowsById = new Map<string, WorkspaceRow>();
  table.rows.forEach((row, index) => {
    if (!row.id || rowsById.has(row.id)) invalid(`Duplicate row identity: ${table.id}`);
    rowsById.set(row.id, row);
    rowIndexes.set(row.id, index);
  });
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
    }
  } else {
    for (let index = 0; index < table.rows.length; index += capacity) {
      const chunkId = makeId('chunk');
      const rows = table.rows.slice(index, index + capacity);
      rows.forEach((row, slot) => locations.set(row.id, { chunkId, slot }));
      chunks.set(chunkId, { tableId: table.id, chunkId, rows });
    }
  }
  if (locations.size !== table.rows.length) invalid(`Incomplete normalized chunks: ${table.id}`);
  return {
    table, chunks, locations, rowIndexes,
    record: { storageFormat: 'row-chunks-v1', definition: definitionOf(table), chunkCapacity: capacity, chunkIds: stored?.record.chunkIds ?? [...chunks.keys()], rowOrder: table.rows.map(row => row.id) },
  };
};

const affectedCellRowIds = (action: WorkspaceTableHistoryAction | undefined) => {
  if (action?.type === 'set-cell') return [action.rowId];
  if (action?.type === 'set-cells') return [...new Set(action.changes.map(change => change.rowId))];
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
  if (affected && previous.table.rows.length === table.rows.length && previous.table.columns === table.columns) {
    for (const id of affected) {
      const index = previous.rowIndexes.get(id);
      const location = previous.locations.get(id);
      const row = index === undefined ? undefined : table.rows[index];
      if (!row || row.id !== id || !location) return invalid(`Cell mutation has invalid row: ${table.id}`);
      replaceRow(row, location);
    }
    const chunks = new Map(previous.chunks);
    for (const [chunkId, rows] of touched) chunks.set(chunkId, { tableId: table.id, chunkId, rows });
    return { ...previous, table, chunks, record: definition === previous.record.definition ? previous.record : { ...previous.record, definition } };
  }

  const seen = new Set<string>();
  const added: WorkspaceRow[] = [];
  let orderChanged = previous.table.rows.length !== table.rows.length;
  table.rows.forEach((row, index) => {
    if (!row.id || seen.has(row.id)) invalid(`Duplicate row identity: ${table.id}`);
    seen.add(row.id);
    if (previous.record.rowOrder[index] !== row.id) orderChanged = true;
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
  const rowOrder = orderChanged ? table.rows.map(row => row.id) : previous.record.rowOrder;
  const record = definition === previous.record.definition && sameChunkIds && !orderChanged ? previous.record : {
    ...previous.record, definition, chunkIds: sameChunkIds ? previous.record.chunkIds : chunkIds, rowOrder,
  };
  return { table, chunks, locations, record, rowIndexes: orderChanged ? new Map(rowOrder.map((id, index) => [id, index])) : previous.rowIndexes };
};

export const planWorkspaceTableStorageWrite = (snapshot: WorkspaceTableStorageSnapshot, saved?: WorkspaceTableStorageSnapshot, legacy = false) => ({
  definition: legacy || !saved || snapshot.record !== saved.record ? snapshot.record : undefined,
  upserts: [...snapshot.chunks.values()].filter(chunk => legacy || saved?.chunks.get(chunk.chunkId) !== chunk),
  deletes: legacy ? [] : [...(saved?.chunks.keys() ?? [])].filter(id => !snapshot.chunks.has(id)),
  state: { updatedAt: snapshot.table.updatedAt, changeRevision: snapshot.table.changeRevision } satisfies StoredWorkspaceTableState,
});
