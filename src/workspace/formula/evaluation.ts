import type { WorkspaceRow } from '../types';
import type { CompiledWorkspaceFormula, FormulaNode } from './syntax';

export interface WorkspaceFormulaResult { value: number | null; error?: string }
export const evaluateWorkspaceFormula = (plan: CompiledWorkspaceFormula, row: WorkspaceRow): WorkspaceFormulaResult => {
  const evaluate = (node: FormulaNode): number | null => {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'source') {
      const raw = row.values[node.columnId];
      if (raw == null || (typeof raw === 'string' && !raw.trim())) return null;
      if (typeof raw !== 'string' && typeof raw !== 'number') throw new Error('來源值不是有效數字');
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('來源值不是有效數字');
      return value;
    }
    if (node.kind === 'unary') {
      const value = evaluate(node.operand);
      return value === null ? null : node.operator === '-' ? -value : value;
    }
    const left = evaluate(node.left), right = evaluate(node.right);
    if (node.operator === '/' && right === 0) throw new Error('除數不能為零');
    if (left === null || right === null) return null;
    const value = node.operator === '+' ? left + right : node.operator === '-' ? left - right : node.operator === '*' ? left * right : left / right;
    if (!Number.isFinite(value)) throw new Error('計算結果不是有限數字');
    return value;
  };
  try { return { value: evaluate(plan.node) }; }
  catch (error) { return { value: null, error: error instanceof Error ? error.message : '無法計算' }; }
};
