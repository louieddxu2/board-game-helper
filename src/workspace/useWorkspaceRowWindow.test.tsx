import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWorkspaceRowWindow } from './useWorkspaceRowWindow';
import type { WorkspaceRow } from './types';

const rows: WorkspaceRow[] = Array.from({ length: 250 }, (_, index) => ({ id: `row-${index}`, name: `項目 ${index}`, values: {} }));

describe('workspace visible row window', () => {
  it('keeps a small table intact and bounds the DOM for a large table', () => {
    const small = renderHook(() => useWorkspaceRowWindow(rows.slice(0, 4), 'table', 0, 600, true));
    expect(small.result.current.visibleRows).toHaveLength(4);
    expect(small.result.current.virtual).toBe(false);
    const large = renderHook(() => useWorkspaceRowWindow(rows, 'table', 0, 600, true));
    expect(large.result.current.visibleRows.length).toBeLessThan(80);
    expect(large.result.current.topPadding).toBe(0);
    expect(large.result.current.bottomPadding).toBeGreaterThan(0);
  });

  it('uses measured variable heights and reaches the final row on a deep scroll', () => {
    const { result, rerender } = renderHook(({ top }) => useWorkspaceRowWindow(rows, 'table', top, 300, true), { initialProps: { top: 0 } });
    act(() => result.current.measureRow('row-0', 120));
    expect(result.current.offsetForRow('row-1')).toBe(120);
    rerender({ top: 9000 });
    expect(result.current.visibleRows.at(-1)?.id).toBe('row-249');
    expect(result.current.bottomPadding).toBe(0);
  });
});
