import type { WorkspaceRow } from './types';

interface SingleRowChange { before: object; rowId: string; index: number }
const singleRowChanges = new WeakMap<readonly WorkspaceRow[], SingleRowChange>();
interface RowMove { before: object; rowId: string; from: number; to: number }
const rowMoves = new WeakMap<readonly WorkspaceRow[], RowMove>();
const rowArrayTokens = new WeakMap<readonly WorkspaceRow[], object>();
const tokenOf = (rows: readonly WorkspaceRow[]) => {
  let token = rowArrayTokens.get(rows);
  if (!token) { token = {}; rowArrayTokens.set(rows, token); }
  return token;
};

/** Only the shared row action producer can certify that retained rows were untouched. */
export const rememberWorkspaceSingleRowChange = (before: readonly WorkspaceRow[], after: readonly WorkspaceRow[], rowId: string, index: number) => {
  const delta = after.length - before.length;
  if ((delta === 1 ? after[index]?.id : delta === -1 ? before[index]?.id : undefined) === rowId) singleRowChanges.set(after, { before: tokenOf(before), rowId, index });
};
export const isWorkspaceSingleRowChange = (before: readonly WorkspaceRow[], after: readonly WorkspaceRow[], rowId: string, index: number) => {
  const change = singleRowChanges.get(after);
  return Boolean(change && change.before === rowArrayTokens.get(before) && change.rowId === rowId && change.index === index);
};

/** Shared move producers certify that only the position changed, including undo/redo. */
export const rememberWorkspaceRowMove = (before: readonly WorkspaceRow[], after: readonly WorkspaceRow[], rowId: string, from: number, to: number) => {
  if (before !== after && before.length === after.length && Number.isSafeInteger(from) && Number.isSafeInteger(to)
    && from >= 0 && to >= 0 && from !== to && before[from]?.id === rowId && after[to] === before[from]) {
    rowMoves.set(after, { before: tokenOf(before), rowId, from, to });
  }
};
export const getWorkspaceRowMove = (before: readonly WorkspaceRow[], after: readonly WorkspaceRow[], rowId: string) => {
  const move = rowMoves.get(after);
  return move && move.before === rowArrayTokens.get(before) && move.rowId === rowId ? move : undefined;
};
