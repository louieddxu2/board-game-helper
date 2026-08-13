import type { WorkspaceCellValue } from './types';

export interface WorkspaceBulkSelection {
  tableId: string;
  columnId: string;
  rowIds: string[];
  hasDraft: boolean;
  sharedValue: WorkspaceCellValue;
  distributedValues?: Record<string, number>;
}

export interface WorkspaceRatioInput {
  rowId: string;
  ratio: number;
}

export const distributeWorkspaceTotal = (
  total: number,
  inputs: WorkspaceRatioInput[],
  roundToIntegers = true,
): Record<string, number> | undefined => {
  if (!Number.isFinite(total) || inputs.length === 0 || inputs.some(({ ratio }) => !Number.isFinite(ratio) || ratio < 0)) return undefined;
  const ratioTotal = inputs.reduce((sum, { ratio }) => sum + ratio, 0);
  if (ratioTotal <= 0) return undefined;
  if (!roundToIntegers) return Object.fromEntries(inputs.map(({ rowId, ratio }) => [rowId, total * ratio / ratioTotal]));

  const sign = total < 0 ? -1 : 1;
  const target = Math.round(Math.abs(total));
  const shares = inputs.map(({ rowId, ratio }, index) => {
    const raw = target * ratio / ratioTotal;
    const base = Math.floor(raw);
    return { rowId, index, base, remainder: raw - base };
  });
  let remaining = target - shares.reduce((sum, share) => sum + share.base, 0);
  const ranked = [...shares].sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  const bonuses = new Set(ranked.slice(0, remaining).map((share) => share.rowId));
  remaining = Math.max(0, remaining);
  return Object.fromEntries(shares.map(({ rowId, base }) => [rowId, sign * (base + (remaining > 0 && bonuses.has(rowId) ? 1 : 0))]));
};
