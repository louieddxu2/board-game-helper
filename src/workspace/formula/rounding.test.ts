import { describe, expect, test, vi } from 'vitest';
import { evaluateWorkspaceFormula } from './evaluation';
import { compileWorkspaceFormula } from './syntax';
import { createWorkspaceValueReader } from './values';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceFormula, WorkspaceRow } from '../types';

const makeFormula = (
  expression: string,
  decimalPlaces?: number,
  variables: Record<string, string> = {},
): WorkspaceFormula => ({
  version: 1,
  expression,
  variables: Object.fromEntries(Object.entries(variables).map(([alias, columnId]) => [alias, { columnId }])),
  ...(decimalPlaces === undefined ? {} : { decimalPlaces }),
});

const makeRow = (values: Record<string, WorkspaceCellValue>, id = 'row-1'): WorkspaceRow => ({ id, name: id, values });

const evaluate = (
  expression: string,
  values: Record<string, WorkspaceCellValue> = {},
  decimalPlaces?: number,
  variables: Record<string, string> = {},
) => evaluateWorkspaceFormula(compileWorkspaceFormula(makeFormula(expression, decimalPlaces, variables)), makeRow(values));

const makeColumn = (id: string, formula: WorkspaceFormula): WorkspaceColumn => ({
  id,
  name: id,
  inputType: 'number',
  options: [],
  formula,
});

describe('workspace formula rounding contract', () => {
  test('preserves default division and rounds the final result at precision 0, 2, or 12', () => {
    const variables = { price: 'price', count: 'count' };
    const values = { price: 1, count: 8 };

    expect(evaluate('price / count', values, undefined, variables)).toEqual({ value: 0.125 });
    expect(evaluate('price / count', values, 0, variables)).toEqual({ value: 0 });
    expect(evaluate('price / count', values, 2, variables)).toEqual({ value: 0.13 });
    expect(evaluate('price / count', values, 12, variables)).toEqual({ value: 0.125 });
  });

  test.each([
    ['1.005', 1.01],
    ['1.275', 1.28],
    ['-1.005', -1.01],
    ['9.995', 10],
  ])('uses half-away-from-zero rounding for %s at two places', (expression, expected) => {
    expect(evaluate(expression, {}, 2)).toEqual({ value: expected });
  });

  test('rounds only the final result, preserving an intermediate fraction', () => {
    expect(evaluate('(1 / 3) * 3', {}, 0)).toEqual({ value: 1 });
  });

  test('handles scientific notation, tiny values, large values, and negative zero', () => {
    const tiny = evaluate('-1e-308', {}, 12);
    const zero = evaluate('-0', {}, 2);
    const large = evaluate('1e308 * 1', {}, 12);

    expect(tiny).toEqual({ value: 0 });
    expect(Object.is(tiny.value, -0)).toBe(false);
    expect(zero).toEqual({ value: 0 });
    expect(Object.is(zero.value, -0)).toBe(false);
    expect(large).toEqual({ value: 1e308 });
    expect(large.error).toBeUndefined();
  });

  test('keeps blank values and zero divisors blank, while preserving overflow errors', () => {
    const division = makeFormula('price / count', 2, { price: 'price', count: 'count' });
    const overflow = makeFormula('price * price', 2, { price: 'price' });

    expect(evaluateWorkspaceFormula(compileWorkspaceFormula(division), makeRow({ price: null, count: 2 }))).toEqual({ value: null });
    expect(evaluateWorkspaceFormula(compileWorkspaceFormula(division), makeRow({ price: 1, count: 0 }))).toEqual({ value: null });
    expect(evaluateWorkspaceFormula(compileWorkspaceFormula(overflow), makeRow({ price: 1e308 }))).toEqual({
      value: null,
      error: expect.stringMatching(/finite|overflow|無限|有限/i),
    });
  });

  test('rejects precision values outside the integer 0 through 12 contract', () => {
    for (const decimalPlaces of [-1, 13, 1.5, '2', null]) {
      const formula = { ...makeFormula('1'), decimalPlaces } as unknown as WorkspaceFormula;
      expect(() => compileWorkspaceFormula(formula)).toThrow(/0～12|integer|整數/i);
    }
    expect(compileWorkspaceFormula(makeFormula('1')).decimalPlaces).toBeUndefined();
  });

  test('invalidates source and constant result caches when only precision changes', () => {
    const evaluateSpy = vi.fn(evaluateWorkspaceFormula);
    const reader = createWorkspaceValueReader(evaluateSpy);
    const row = makeRow({ price: 1, count: 3 });
    const sourceFormula = makeFormula('price / count', undefined, { price: 'price', count: 'count' });
    const sourceColumn = makeColumn('source-result', sourceFormula);

    expect(reader.read(row, sourceColumn).value).toBe(1 / 3);
    expect(reader.read({ ...row, values: { ...row.values } }, { ...sourceColumn, formula: sourceFormula }).value).toBe(1 / 3);
    expect(evaluateSpy).toHaveBeenCalledTimes(1);

    const roundedSourceFormula = { ...sourceFormula, decimalPlaces: 2 };
    const roundedSourceColumn = { ...sourceColumn, formula: roundedSourceFormula };
    expect(reader.read(row, roundedSourceColumn).value).toBe(0.33);
    expect(reader.read(row, roundedSourceColumn).value).toBe(0.33);
    expect(evaluateSpy).toHaveBeenCalledTimes(2);

    const constantFormula = makeFormula('1 / 3');
    const constantColumn = makeColumn('constant-result', constantFormula);
    expect(reader.read(makeRow({}, 'constant-1'), constantColumn).value).toBe(1 / 3);
    expect(reader.read(makeRow({}, 'constant-2'), constantColumn).value).toBe(1 / 3);
    expect(evaluateSpy).toHaveBeenCalledTimes(3);

    const roundedConstantColumn = { ...constantColumn, formula: { ...constantFormula, decimalPlaces: 2 } };
    expect(reader.read(makeRow({}, 'constant-1'), roundedConstantColumn).value).toBe(0.33);
    expect(reader.read(makeRow({}, 'constant-2'), roundedConstantColumn).value).toBe(0.33);
    expect(evaluateSpy).toHaveBeenCalledTimes(4);
  });
});
