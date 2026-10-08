import { makeId } from './model';
import type { WorkspaceTableHistoryAction } from './history';
import type { WorkspaceTable } from './types';
import type { WorkspaceTableDefinition, WorkspaceTableStorageSnapshot } from './rowChunkStorage';
import { spliceWorkspaceRowOrder } from './rowOrderStorage';
import { isWorkspaceSingleRowChange } from './rowStructureChanges';

/** Explicit single-row commands avoid comparing every existing row and rebuilding its IDs. */
export const updateWorkspaceSingleRowStorage = (previous: WorkspaceTableStorageSnapshot, table: WorkspaceTable, action: WorkspaceTableHistoryAction | undefined, definition: WorkspaceTableDefinition): WorkspaceTableStorageSnapshot | undefined => {
  if (action?.type !== 'add-row' && action?.type !== 'remove-row') return undefined;
  const id = action.row?.id;
  const delta = table.rows.length - previous.table.rows.length;
  const adding = delta === 1;
  const index = adding ? action.index : previous.rowIndexes.get(id);
  if (!id || (delta !== 1 && delta !== -1) || index === undefined || !Number.isSafeInteger(index) || index < 0
    || (adding ? previous.locations.has(id) || table.rows[index]?.id !== id : index !== action.index || table.rows[index]?.id === id)
    || !isWorkspaceSingleRowChange(previous.table.rows, table.rows, id, index)) return undefined;

  const chunks = new Map(previous.chunks);
  const locations = new Map(previous.locations);
  if (adding) {
    const available = [...chunks.values()].find(chunk => chunk.rows.length < previous.record.chunkCapacity);
    const chunkId = available?.chunkId ?? makeId('chunk');
    const rows = [...(available?.rows ?? []), table.rows[index]];
    chunks.set(chunkId, { tableId: table.id, chunkId, rows });
    locations.set(id, { chunkId, slot: rows.length - 1 });
  } else {
    const location = previous.locations.get(id);
    if (!location) return undefined;
    const before = chunks.get(location.chunkId)!;
    const rows = [...before.rows.slice(0, location.slot), ...before.rows.slice(location.slot + 1)];
    if (rows.length) chunks.set(location.chunkId, { ...before, rows });
    else chunks.delete(location.chunkId);
    locations.delete(id);
    for (let slot = location.slot; slot < rows.length; slot++) locations.set(rows[slot].id, { chunkId: location.chunkId, slot });
  }
  const rowIndexes = new Map(previous.rowIndexes);
  if (!adding) rowIndexes.delete(id);
  for (let position = index; position < table.rows.length; position++) rowIndexes.set(table.rows[position].id, position);
  const order = spliceWorkspaceRowOrder(previous.order, table.id, index, adding ? 0 : 1, adding ? [id] : []);
  const chunkIds = [...chunks.keys()];
  const sameChunkIds = chunkIds.length === previous.record.chunkIds.length && chunkIds.every((chunkId, position) => chunkId === previous.record.chunkIds[position]);
  const record = definition === previous.record.definition && sameChunkIds && order.pageIds === previous.record.orderPageIds ? previous.record : {
    ...previous.record, definition, chunkIds: sameChunkIds ? previous.record.chunkIds : chunkIds, orderPageIds: order.pageIds,
  };
  return { table, record, chunks, locations, rowIndexes, order, rowOrderChange: { beforeRows: previous.table.rows, from: index } };
};
