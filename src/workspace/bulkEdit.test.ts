import { describe, expect, it } from 'vitest';
import { distributeWorkspaceTotal } from './bulkEdit';

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
