import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceRow } from '../types';
import { compileWorkspaceFormula, type CompiledWorkspaceFormula } from './syntax';
import { evaluateWorkspaceFormula, type WorkspaceFormulaResult } from './evaluation';

export interface WorkspaceResolvedCell { value: WorkspaceCellValue; error?: string }
export type WorkspaceCellReader = (row: WorkspaceRow, column: WorkspaceColumn, isRowHeader?: boolean) => WorkspaceResolvedCell;
const displayResult = (result: WorkspaceFormulaResult): WorkspaceResolvedCell => result.error
  ? { value: `無法計算：${result.error}`, error: result.error } : result;
interface Entry { sources: WorkspaceCellValue[]; result: WorkspaceResolvedCell }

/** A reader belongs to one display/export context and never retains table or row objects. */
export const createWorkspaceValueReader = (evaluate = evaluateWorkspaceFormula) => {
  const columns = new Map<string, { plan: CompiledWorkspaceFormula; rows: Map<string, Entry>; constant?: WorkspaceResolvedCell }>();
  const read: WorkspaceCellReader = (row, column, isRowHeader = false) => {
    if (isRowHeader || !column.formula) return { value: (isRowHeader ? row.name : row.values[column.id]) ?? null };
    try {
      const plan = compileWorkspaceFormula(column.formula);
      let cache = columns.get(column.id);
      if (!cache || cache.plan !== plan) { cache = { plan, rows: new Map() }; columns.set(column.id, cache); }
      if (!plan.sources.length) return cache.constant ??= displayResult(evaluate(plan, row));
      const prior = cache.rows.get(row.id);
      if (prior && plan.sources.every((id, index) => Object.is(prior.sources[index], row.values[id] ?? null))) return prior.result;
      const sources = plan.sources.map(id => row.values[id] ?? null);
      const result = displayResult(evaluate(plan, row));
      cache.rows.set(row.id, { sources, result });
      return result;
    } catch (error) { return displayResult({ value: null, error: error instanceof Error ? error.message : '公式設定格式不正確' }); }
  };
  return {
    read,
    releaseRow(id: string) { for (const cache of columns.values()) cache.rows.delete(id); },
    retainRows(ids: ReadonlySet<string>) { for (const cache of columns.values()) for (const id of cache.rows.keys()) if (!ids.has(id)) cache.rows.delete(id); },
    retainColumns(ids: ReadonlySet<string>) { for (const id of columns.keys()) if (!ids.has(id)) columns.delete(id); },
  };
};

/** Stateless fallback for standalone consumers; owners share a contextual reader. */
export const getWorkspaceEffectiveCell: WorkspaceCellReader = (row, column, isRowHeader) => {
  if (isRowHeader || !column.formula) return { value: (isRowHeader ? row.name : row.values[column.id]) ?? null };
  try { return displayResult(evaluateWorkspaceFormula(compileWorkspaceFormula(column.formula), row)); }
  catch (error) { return displayResult({ value: null, error: error instanceof Error ? error.message : '公式設定格式不正確' }); }
};
