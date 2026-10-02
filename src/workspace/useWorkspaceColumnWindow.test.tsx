import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWorkspaceColumnWindow } from './useWorkspaceColumnWindow';
import type { WorkspaceRow } from './types';

const rows: WorkspaceRow[] = Array.from({ length: 250 }, (_, index) => ({ id: `row-${index}`, name: `項目 ${index}`, values: {} }));
const widths = [100, ...rows.map(() => 50)];

describe('transposed workspace visible columns', () => {
  it('preserves small tables and bounds a large transposed table', () => {
    const small = renderHook(() => useWorkspaceColumnWindow(rows.slice(0, 4), widths.slice(0, 5), 0, 390, true));
    expect(small.result.current.virtual).toBe(false);
    expect(small.result.current.visibleRows).toHaveLength(4);
    const large = renderHook(() => useWorkspaceColumnWindow(rows, widths, 0, 390, true));
    expect(large.result.current.visibleRows.length).toBeLessThan(40);
    expect(large.result.current.rightPadding).toBeGreaterThan(0);
  });

  it('accounts for the sticky axis and reaches the final column', () => {
    const { result, rerender } = renderHook(({ left }) => useWorkspaceColumnWindow(rows, widths, left, 390, true), { initialProps: { left: 0 } });
    expect(result.current.offsetForRow('row-1')).toBe(150);
    rerender({ left: 12500 });
    expect(result.current.visibleRows.at(-1)?.id).toBe('row-249');
    expect(result.current.rightPadding).toBe(0);
  });

  it('recomputes exact offsets from the visible object identities after filtering', () => {
    const nextRows = rows.slice(40, 200);
    const nextWidths = [100, ...nextRows.map(() => 50)];
    const { result, rerender } = renderHook(({ visibleRows, visibleWidths }) => useWorkspaceColumnWindow(visibleRows, visibleWidths, 0, 390, true), {
      initialProps: { visibleRows: rows, visibleWidths: widths },
    });

    rerender({ visibleRows: nextRows, visibleWidths: nextWidths });
    expect(result.current.visibleRows[0]?.id).toBe('row-40');
    expect(result.current.offsetForRow('row-100')).toBe(100 + 60 * 50);
    expect(result.current.offsetForRow('row-39')).toBeUndefined();
  });
});
