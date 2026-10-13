import { describe, expect, it, vi } from 'vitest';
import { compileWorkspaceFormula } from './syntax';
import { evaluateWorkspaceFormula } from './evaluation';
import { createWorkspaceValueReader } from './values';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceFormula, WorkspaceRow } from '../types';

const makeFormula = (expression: string, variables: Record<string, string> = {}): WorkspaceFormula => ({
  version: 1,
  expression,
  variables: Object.fromEntries(Object.entries(variables).map(([alias, columnId]) => [alias, { columnId }])),
});

const makeColumn = (id: string, name = id, formula?: WorkspaceFormula): WorkspaceColumn => ({
  id,
  name,
  inputType: 'number',
  options: [],
  ...(formula ? { formula } : {}),
});

const makeRow = (id: string, values: Record<string, WorkspaceCellValue>, name = id): WorkspaceRow => ({
  id,
  name,
  values,
});

describe('workspace formula syntax and evaluation', () => {
  it('evaluates variables, constants, unary signs, parentheses, precedence, and multiplication symbols', () => {
    const formula = makeFormula('-(price + 2) × (count - 1) / 2', { price: 'price', count: 'count' });
    const plan = compileWorkspaceFormula(formula);
    const result = evaluateWorkspaceFormula(plan, makeRow('row-1', { price: 8, count: 5 }));

    expect(result.value).toBe(-20);
    expect(result.error).toBeUndefined();
  });

  it('accepts decimal and scientific notation constants', () => {
    const plan = compileWorkspaceFormula(makeFormula('1.5e2 + 0.5'));
    const result = evaluateWorkspaceFormula(plan, makeRow('row-1', {}));

    expect(result.value).toBe(150.5);
    expect(result.error).toBeUndefined();
  });

  it('supports Chinese aliases and bracket-quoted aliases containing spaces and punctuation', () => {
    const formula = makeFormula('[價格 (元)] ÷ 次數', { '價格 (元)': 'price', 次數: 'count' });
    const plan = compileWorkspaceFormula(formula);
    const result = evaluateWorkspaceFormula(plan, makeRow('row-1', { price: 1200, count: 6 }));

    expect(result.value).toBe(200);
    expect(result.error).toBeUndefined();
  });

  it('reports each used variable once and only includes referenced source columns', () => {
    const plan = compileWorkspaceFormula(makeFormula('price + price × count', {
      price: 'column-price',
      count: 'column-count',
      unused: 'column-unused',
    }));

    expect(plan.variablesUsed).toEqual(['price', 'count']);
    expect(plan.sources).toEqual(['column-price', 'column-count']);
  });

  it('rejects unknown variables, invalid syntax, unsupported versions, and excessive nesting', () => {
    expect(() => compileWorkspaceFormula(makeFormula('missing + 1', { price: 'price' })))
      .toThrow(/unknown|variable|未知|未定義/i);
    expect(() => compileWorkspaceFormula(makeFormula('price +', { price: 'price' })))
      .toThrow(/syntax|invalid|公式|運算式/i);
    expect(() => compileWorkspaceFormula({ ...makeFormula('1'), version: 2 } as unknown as WorkspaceFormula))
      .toThrow(/version|版本|unsupported/i);

    const nested = `${'('.repeat(33)}1${')'.repeat(33)}`;
    expect(() => compileWorkspaceFormula(makeFormula(nested)))
      .toThrow(/nest|depth|深度|層/i);
  });

  it('treats blank source values as blank results and accepts legacy numeric strings', () => {
    const plan = compileWorkspaceFormula(makeFormula('price / count', { price: 'price', count: 'count' }));

    expect(evaluateWorkspaceFormula(plan, makeRow('numeric', { price: '6', count: 2 })).value).toBe(3);
    expect(evaluateWorkspaceFormula(plan, makeRow('empty-string', { price: '', count: 2 })).value).toBeNull();
    expect(evaluateWorkspaceFormula(plan, makeRow('null', { price: null, count: 2 })).value).toBeNull();
  });

  it('keeps zero numerators valid while reporting zero divisors', () => {
    const plan = compileWorkspaceFormula(makeFormula('price / count', { price: 'price', count: 'count' }));

    const zero = evaluateWorkspaceFormula(plan, makeRow('zero', { price: 0, count: 5 }));
    expect(zero.value).toBe(0);
    expect(zero.error).toBeUndefined();

    const divisor = evaluateWorkspaceFormula(plan, makeRow('divisor', { price: 1, count: 0 }));
    expect(divisor.value).toBeNull();
    expect(divisor.error).toMatch(/zero|divide|除數/i);
  });

  it('reports invalid source values and non-finite arithmetic results', () => {
    const sourcePlan = compileWorkspaceFormula(makeFormula('price + 1', { price: 'price' }));
    const invalid = evaluateWorkspaceFormula(sourcePlan, makeRow('invalid', {
      price: { url: 'https://example.com', label: '連結' },
    }));
    expect(invalid.value).toBeNull();
    expect(invalid.error).toMatch(/number|numeric|數字|值/i);

    const overflowPlan = compileWorkspaceFormula(makeFormula('price × price', { price: 'price' }));
    const overflow = evaluateWorkspaceFormula(overflowPlan, makeRow('overflow', { price: 1e308 }));
    expect(overflow.value).toBeNull();
    expect(overflow.error).toMatch(/finite|overflow|無限|有限/i);
  });
});

describe('workspace formula value reader', () => {
  const sourceColumns = { price: 'price', count: 'count' };
  const formula = makeFormula('price / count', sourceColumns);
  const calculatedColumn = makeColumn('calculated', '性價比', formula);

  it('passes ordinary values through and reads the row header when requested', () => {
    const reader = createWorkspaceValueReader();
    const plainColumn = makeColumn('note', '備註');
    const row = makeRow('row-1', { note: '保留文字' }, '項目名稱');

    expect(reader.read(row, plainColumn)).toMatchObject({ value: '保留文字' });
    expect(reader.read(row, plainColumn, true)).toMatchObject({ value: '項目名稱' });
  });

  it('evaluates the same row and formula once for repeated consumers', () => {
    const evaluate = vi.fn(evaluateWorkspaceFormula);
    const reader = createWorkspaceValueReader(evaluate);
    const row = makeRow('row-1', { price: 12, count: 3 });

    expect(reader.read(row, calculatedColumn).value).toBe(4);
    expect(reader.read(row, calculatedColumn).value).toBe(4);
    expect(reader.read({ ...row, values: { ...row.values } }, calculatedColumn).value).toBe(4);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('recalculates only the row whose referenced operand changed', () => {
    const evaluate = vi.fn(evaluateWorkspaceFormula);
    const reader = createWorkspaceValueReader(evaluate);
    const first = makeRow('row-1', { price: 12, count: 3 });
    const second = makeRow('row-2', { price: 20, count: 4 });

    expect(reader.read(first, calculatedColumn).value).toBe(4);
    expect(reader.read(second, calculatedColumn).value).toBe(5);
    const changedFirst = makeRow('row-1', { price: 15, count: 3 });
    expect(reader.read(changedFirst, calculatedColumn).value).toBe(5);
    expect(reader.read(second, calculatedColumn).value).toBe(5);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it('reuses a row result when an unrelated field changes', () => {
    const evaluate = vi.fn(evaluateWorkspaceFormula);
    const reader = createWorkspaceValueReader(evaluate);
    const row = makeRow('row-1', { price: 12, count: 3, note: '原始' });

    expect(reader.read(row, calculatedColumn).value).toBe(4);
    const changedNote = makeRow('row-1', { price: 12, count: 3, note: '更新備註' });
    expect(reader.read(changedNote, calculatedColumn).value).toBe(4);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('invalidates a cached result when the formula is replaced', () => {
    const evaluate = vi.fn(evaluateWorkspaceFormula);
    const reader = createWorkspaceValueReader(evaluate);
    const row = makeRow('row-1', { price: 12, count: 3 });
    const replacement = makeColumn('calculated', '性價比', makeFormula('price + count', sourceColumns));

    expect(reader.read(row, calculatedColumn).value).toBe(4);
    expect(reader.read(row, replacement).value).toBe(15);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('shares constant-only formula results across rows', () => {
    const evaluate = vi.fn(evaluateWorkspaceFormula);
    const reader = createWorkspaceValueReader(evaluate);
    const constantColumn = makeColumn('constant', '固定計算', makeFormula('2 + 3'));

    expect(reader.read(makeRow('row-1', {}), constantColumn).value).toBe(5);
    expect(reader.read(makeRow('row-2', {}), constantColumn).value).toBe(5);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('returns a visible error value and detail for formula failures', () => {
    const reader = createWorkspaceValueReader();
    const result = reader.read(makeRow('row-1', { price: 1, count: 0 }), calculatedColumn);

    expect(typeof result.value).toBe('string');
    expect(result.error).toMatch(/zero|divide|除數/i);
  });
});
