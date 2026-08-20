import { formatMultiSelectValues, parseMultiSelectValues } from './model';
import type { WorkspaceCellValue } from './types';

export interface WorkspaceBulkSelection {
  tableId: string;
  columnId: string;
  rowIds: string[];
}

export type WorkspaceMultiSelectBatchAction = 'add' | 'remove';

export interface WorkspaceMultiSelectBatchIntent {
  option: string;
  action: WorkspaceMultiSelectBatchAction;
}

export interface WorkspaceMultiSelectOptionSummary {
  option: string;
  count: number;
  total: number;
}

export interface WorkspaceMultiSelectBatchRow {
  rowId: string;
  value: WorkspaceCellValue;
}

const uniqueOptions = (options: string[]) => {
  const seen = new Set<string>();
  return options.flatMap((raw) => {
    const option = raw.trim();
    const key = option.toLocaleLowerCase();
    if (!option || seen.has(key)) return [];
    seen.add(key);
    return [option];
  });
};

export const summarizeWorkspaceMultiSelectOptions = (
  rows: WorkspaceMultiSelectBatchRow[],
  configuredOptions: string[],
): WorkspaceMultiSelectOptionSummary[] => {
  const parsedRows = rows.map((row) => uniqueOptions(parseMultiSelectValues(row.value)));
  const options = uniqueOptions([...configuredOptions, ...parsedRows.flat()]);
  return options.map((option) => ({
    option,
    count: parsedRows.filter((values) => values.some((value) => value.toLocaleLowerCase() === option.toLocaleLowerCase())).length,
    total: rows.length,
  }));
};

export const applyWorkspaceMultiSelectBatch = (
  rows: WorkspaceMultiSelectBatchRow[],
  intents: WorkspaceMultiSelectBatchIntent[],
): Array<{ rowId: string; value: WorkspaceCellValue }> => {
  if (!intents.length) return [];
  return rows.flatMap((row) => {
    const before = uniqueOptions(parseMultiSelectValues(row.value));
    const next = [...before];
    for (const intent of intents) {
      const index = next.findIndex((value) => value.toLocaleLowerCase() === intent.option.toLocaleLowerCase());
      if (intent.action === 'add' && index < 0) next.push(intent.option);
      if (intent.action === 'remove' && index >= 0) next.splice(index, 1);
    }
    if (JSON.stringify(before) === JSON.stringify(next)) return [];
    const value = next.length ? formatMultiSelectValues(next) : null;
    return [{ rowId: row.rowId, value }];
  });
};

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
