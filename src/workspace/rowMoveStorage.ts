import type { WorkspaceTableHistoryAction } from './history';
import type { WorkspaceTable } from './types';
import type { WorkspaceTableDefinition, WorkspaceTableStorageSnapshot } from './rowChunkStorage';
import { moveWorkspaceRowOrder } from './rowOrderStorage';
import { getWorkspaceRowMove } from './rowStructureChanges';

/** A certified move keeps canonical values and locations unchanged. */
export const updateWorkspaceRowMoveStorage = (previous: WorkspaceTableStorageSnapshot, table: WorkspaceTable, action: WorkspaceTableHistoryAction | undefined, definition: WorkspaceTableDefinition): WorkspaceTableStorageSnapshot | undefined => {
  if (action?.type !== 'move-row' || previous.table.rows.length !== table.rows.length) return undefined;
  const move = getWorkspaceRowMove(previous.table.rows, table.rows, action.rowId);
  if (!move || previous.rowIndexes.get(action.rowId) !== move.from) return undefined;
  const rowIndexes = new Map(previous.rowIndexes);
  for (let position = Math.min(move.from, move.to); position <= Math.max(move.from, move.to); position++) rowIndexes.set(table.rows[position].id, position);
  const order = moveWorkspaceRowOrder(previous.order, table.id, move.from, move.to);
  const record = definition === previous.record.definition && order.pageIds === previous.record.orderPageIds ? previous.record
    : { ...previous.record, definition, orderPageIds: order.pageIds };
  return { ...previous, table, record, rowIndexes, order, rowOrderChange: { beforeRows: previous.table.rows, from: move.from, to: move.to } };
};
