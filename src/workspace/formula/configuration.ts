import type { WorkspaceColumn, WorkspaceFormula } from '../types';
import { compileWorkspaceFormula } from './syntax';

export const normalizeWorkspaceFormula = (formula: WorkspaceFormula): WorkspaceFormula => {
  const plan = compileWorkspaceFormula(formula);
  const keys = Object.keys(formula.variables);
  if (keys.length === plan.variablesUsed.length && keys.every(key => plan.variablesUsed.includes(key))) return formula;
  return { ...formula, variables: Object.fromEntries(plan.variablesUsed.map(name => [name, { columnId: formula.variables[name].columnId }])) };
};

export const validateWorkspaceFormulaColumns = (columns: readonly WorkspaceColumn[], rowHeader?: WorkspaceColumn) => {
  if (rowHeader?.formula) throw new Error('物件名稱欄不支援自動計算');
  const byId = new Map(columns.map(column => [column.id, column]));
  for (const column of columns) {
    if (!column.formula) continue;
    if (column.inputType !== 'number') throw new Error(`「${column.name}」的自動計算只支援數字類型`);
    for (const id of compileWorkspaceFormula(column.formula).sources) {
      const source = byId.get(id);
      if (!source || source.id === column.id || source.inputType !== 'number' || source.formula) throw new Error(`「${column.name}」的公式只能引用其他原始數字屬性`);
    }
  }
};

export const workspaceFormulaDependents = (columns: readonly WorkspaceColumn[], columnId: string) => columns.filter(column => column.formula && compileWorkspaceFormula(column.formula).sources.includes(columnId));
export const quoteWorkspaceFormulaVariable = (name: string) => `[${name.replaceAll(']', ']]')}]`;

export const formulaVariableChoices = (columns: readonly WorkspaceColumn[], targetId: string, formula: WorkspaceFormula) => {
  const bindings = { ...formula.variables };
  const used = new Set(Object.keys(bindings));
  return columns.filter(column => column.id !== targetId && column.inputType === 'number' && !column.formula).map(column => {
    let alias = Object.keys(bindings).find(name => bindings[name].columnId === column.id);
    if (!alias) {
      const base = column.name.trim() || '屬性';
      alias = base;
      for (let suffix = 2; used.has(alias); suffix++) alias = `${base}_${suffix}`;
      used.add(alias); bindings[alias] = { columnId: column.id };
    }
    return { column, alias, binding: { columnId: column.id } };
  });
};
