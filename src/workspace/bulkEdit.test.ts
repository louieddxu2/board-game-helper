import { describe, expect, it } from 'vitest';
import { applyWorkspaceMultiSelectBatch, distributeWorkspaceTotal, summarizeWorkspaceMultiSelectOptions } from './bulkEdit';

describe('workspace proportional distribution', () => {
  it('preserves an integer total after rounding by assigning largest remainders first', () => {
    expect(distributeWorkspaceTotal(10, [
      { rowId: 'a', ratio: 1 },
      { rowId: 'b', ratio: 1 },
      { rowId: 'c', ratio: 1 },
    ])).toEqual({ a: 4, b: 3, c: 3 });
  });

  it('supports exact decimals and rejects unusable ratios', () => {
    expect(distributeWorkspaceTotal(10, [{ rowId: 'a', ratio: 1 }, { rowId: 'b', ratio: 3 }], false)).toEqual({ a: 2.5, b: 7.5 });
    expect(distributeWorkspaceTotal(10, [{ rowId: 'a', ratio: 0 }])).toBeUndefined();
    expect(distributeWorkspaceTotal(10, [{ rowId: 'a', ratio: -1 }])).toBeUndefined();
  });
});

describe('workspace multi-select batch editing', () => {
  const rows = [
    { rowId: 'a', value: '合作, 卡牌' },
    { rowId: 'b', value: '合作, 策略' },
    { rowId: 'c', value: null },
  ];

  it('summarizes configured and legacy options across every selected row', () => {
    expect(summarizeWorkspaceMultiSelectOptions(rows, ['合作', '家庭'])).toEqual([
      { option: '合作', count: 2, total: 3 },
      { option: '家庭', count: 0, total: 3 },
      { option: '卡牌', count: 1, total: 3 },
      { option: '策略', count: 1, total: 3 },
    ]);
  });

  it('adds and removes options independently while preserving untouched values', () => {
    expect(applyWorkspaceMultiSelectBatch(rows, [
      { option: '家庭', action: 'add' },
      { option: '合作', action: 'remove' },
    ])).toEqual([
      { rowId: 'a', value: '卡牌, 家庭' },
      { rowId: 'b', value: '策略, 家庭' },
      { rowId: 'c', value: '家庭' },
    ]);
  });

  it('returns only rows whose stored value actually changes', () => {
    expect(applyWorkspaceMultiSelectBatch(rows, [{ option: '合作', action: 'add' }])).toEqual([
      { rowId: 'c', value: '合作' },
    ]);
    expect(applyWorkspaceMultiSelectBatch([
      { rowId: 'json', value: '["合作"]' },
      { rowId: 'empty', value: null },
    ], [{ option: '合作', action: 'add' }])).toEqual([{ rowId: 'empty', value: '合作' }]);
    expect(applyWorkspaceMultiSelectBatch(rows, [])).toEqual([]);
  });
});
