import { describe, expect, it } from 'vitest';
import type { WorkspaceColumn, WorkspaceFormula } from '../types';
import { getWorkspaceFormulaError, getWorkspaceFormulaErrors } from './configuration';

const makeFormula = (expression: string, columnId: string, alias = '來源'): WorkspaceFormula => ({
  version: 1,
  expression,
  variables: { [alias]: { columnId } },
});

const makeColumn = (id: string, inputType: WorkspaceColumn['inputType'] = 'number', formula?: WorkspaceFormula): WorkspaceColumn => ({
  id,
  name: id,
  inputType,
  options: [],
  ...(formula ? { formula } : {}),
});

describe('workspace formula definition errors', () => {
  it('reports syntax, missing, non-number, computed, and self references without reading rows', () => {
    const source = makeColumn('source');
    const text = makeColumn('text', 'text');
    const computedSource = makeColumn('computed-source', 'number', makeFormula('1', 'source'));
    const syntax = makeColumn('syntax', 'number', makeFormula('來源 +', 'source'));
    const missing = makeColumn('missing', 'number', makeFormula('來源 + 1', 'absent'));
    const nonNumber = makeColumn('non-number', 'number', makeFormula('文字 + 1', 'text', '文字'));
    const computed = makeColumn('computed', 'number', makeFormula('計算 + 1', 'computed-source', '計算'));
    const self = makeColumn('self', 'number', makeFormula('自己 + 1', 'self', '自己'));
    const columns = Object.freeze([source, text, computedSource, syntax, missing, nonNumber, computed, self]);

    expect(getWorkspaceFormulaError(syntax, columns)).toMatch(/公式第|需要/);
    expect(getWorkspaceFormulaError(missing, columns)).toMatch(/只能引用其他原始數字屬性/);
    expect(getWorkspaceFormulaError(nonNumber, columns)).toMatch(/只能引用其他原始數字屬性/);
    expect(getWorkspaceFormulaError(computed, columns)).toMatch(/只能引用其他原始數字屬性/);
    expect(getWorkspaceFormulaError(self, columns)).toMatch(/只能引用其他原始數字屬性/);
  });

  it('caches by immutable columns identity and recovers after a new columns array fixes a definition', () => {
    const source = makeColumn('source');
    const invalid = makeColumn('computed', 'number', makeFormula('來源 + 1', 'absent'));
    const columns = Object.freeze([source, invalid]);

    const first = getWorkspaceFormulaErrors(columns);
    expect(first.get('computed')).toMatch(/只能引用其他原始數字屬性/);
    expect(getWorkspaceFormulaErrors(columns)).toBe(first);

    const repaired = { ...invalid, formula: makeFormula('來源 + 1', 'source') };
    const repairedColumns = Object.freeze([source, repaired]);
    const recovered = getWorkspaceFormulaErrors(repairedColumns);
    expect(recovered).not.toBe(first);
    expect(recovered.has('computed')).toBe(false);
    expect(getWorkspaceFormulaErrors(repairedColumns)).toBe(recovered);
  });
});
