import { StrictMode, useLayoutEffect } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyWorkspaceCellChanges } from './cellChanges';
import { getWorkspaceRowIndexes } from './rowIndexes';
import { useWorkspaceRowWindow } from './useWorkspaceRowWindow';
import type { WorkspaceRow } from './types';

const rows: WorkspaceRow[] = Array.from({ length: 250 }, (_, index) => ({ id: `row-${index}`, name: `項目 ${index}`, values: {} }));

const animationFrames = () => {
  const previousRequestAnimationFrame = window.requestAnimationFrame;
  const previousCancelAnimationFrame = window.cancelAnimationFrame;
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (id: number) => { callbacks.delete(id); },
  });
  return {
    get pending() { return callbacks.size; },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    },
    restore() {
      Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: previousRequestAnimationFrame });
      Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: previousCancelAnimationFrame });
    },
  };
};

describe('workspace visible row window', () => {
  it('keeps offscreen height estimates and the mounted buffer while dynamic widths settle', () => {
    const frames = animationFrames();
    try {
      const { result, rerender } = renderHook(({ key, top }) => useWorkspaceRowWindow(rows, key, top, 180, true, 'table', 'order', false, true), { initialProps: { key: 'narrow', top: 0 } });
      const last = result.current.last;
      act(() => { result.current.measureRow('row-0', 100); result.current.measureRow('row-1', 100); });
      act(() => frames.flush());
      expect(result.current.last).toBe(last);
      rerender({ key: 'wide', top: 0 });
      expect(result.current.offsetForRow('row-2')).toBe(200);
      expect(result.current.last).toBe(last);
      rerender({ key: 'wide', top: 1500 });
      expect(result.current.first).toBeGreaterThan(0);
    } finally { frames.restore(); }
  });

  it('keeps disabled and empty tables unvirtualized without pending anchors', () => {
    const disabled = renderHook(() => useWorkspaceRowWindow(rows, 'table', 0, 600, false));
    expect(disabled.result.current.virtual).toBe(false);
    expect(disabled.result.current.visibleRows).toHaveLength(rows.length);
    expect(disabled.result.current.pendingScrollTop).toBeUndefined();

    const empty = renderHook(() => useWorkspaceRowWindow([], 'table', 0, 600, true));
    expect(empty.result.current.virtual).toBe(false);
    expect(empty.result.current.visibleRows).toEqual([]);
    expect(empty.result.current.topPadding).toBe(0);
    expect(empty.result.current.bottomPadding).toBe(0);
    expect(empty.result.current.pendingScrollTop).toBeUndefined();
  });

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
    const frames = animationFrames();
    try {
      const { result, rerender } = renderHook(({ top }) => useWorkspaceRowWindow(rows, 'table', top, 300, true), { initialProps: { top: 0 } });
      act(() => result.current.measureRow('row-0', 120));
      expect(frames.pending).toBe(1);
      act(() => frames.flush());
      expect(result.current.offsetForRow('row-1')).toBe(120);
      rerender({ top: 9000 });
      expect(result.current.visibleRows.at(-1)?.id).toBe('row-249');
      expect(result.current.bottomPadding).toBe(0);
    } finally {
      frames.restore();
    }
  });

  it('keeps a measured deep anchor and warmed indexes through a value edit without scanning offscreen ids', () => {
    const frames = animationFrames();
    const reads: string[] = [];
    const trackedRows = Array.from({ length: 10_000 }, (_, index) => {
      const id = `row-${index}`;
      const row = { name: `項目 ${index}`, values: { value: null } } as unknown as WorkspaceRow;
      Object.defineProperty(row, 'id', { configurable: true, enumerable: true, get: () => { reads.push(id); return id; } });
      return row;
    });
    const indexes = getWorkspaceRowIndexes(trackedRows);
    const scrollTop = 9_000 * 36 + 20;
    try {
      const { result, rerender } = renderHook(({ currentRows }) => useWorkspaceRowWindow(currentRows, 'table', scrollTop, 180, true), { initialProps: { currentRows: trackedRows } });
      reads.length = 0;
      act(() => result.current.measureRow('row-9000', 120));
      act(() => frames.flush());
      expect(result.current.indexes).toBe(indexes);
      expect(result.current.offsetForRow('row-9001')).toBe(9_001 * 36 + 84);
      expect(result.current.pendingScrollTop).toBe(scrollTop);

      const edited = applyWorkspaceCellChanges(trackedRows, undefined, [{ rowId: 'row-9000', columnId: 'value', before: null, after: 'edited' }]);
      rerender({ currentRows: edited });
      expect(result.current.indexes).toBe(indexes);
      expect(result.current.offsetForRow('row-9001')).toBe(9_001 * 36 + 84);
      expect(result.current.pendingScrollTop).toBe(scrollTop);
      expect(edited[0]).toBe(trackedRows[0]);
      expect(edited[9_000].values.value).toBe('edited');
      expect(reads.filter(id => id !== 'row-9000')).toEqual([]);
      expect(reads.length).toBeLessThan(10);
    } finally {
      frames.restore();
    }
  });

  it('batches measured rows and keeps the same row plus its within-row offset after a resize', () => {
    const frames = animationFrames();
    try {
      const { result } = renderHook(() => useWorkspaceRowWindow(rows, 'table', 371, 180, true));
      act(() => {
        result.current.measureRow('row-0', 72);
        result.current.measureRow('row-1', 60);
      });
      expect(frames.pending).toBe(1);
      act(() => frames.flush());

      // The initial anchor is row-10 with 11px already scrolled into it.
      expect(result.current.pendingScrollTop).toBe(431);
      expect(result.current.pendingStickToBottom).toBe(false);
      expect(result.current.offsetForRow('row-10')).toBe(420);
    } finally {
      frames.restore();
    }
  });

  it('anchors by row identity when rows before the viewport are filtered out', () => {
    const initialRows = rows;
    const nextRows = rows.filter((row) => !/^row-[0-4]$/.test(row.id));
    const { result, rerender } = renderHook(({ visibleRows }) => useWorkspaceRowWindow(visibleRows, 'table', 360, 180, true, 'table', 'same-order'), { initialProps: { visibleRows: initialRows } });

    rerender({ visibleRows: nextRows });
    // row-10 was at offset 360 and is now at index 5; its identity wins over
    // the old numeric index, so the pending scroll follows it to offset 180.
    expect(result.current.pendingScrollTop).toBe(180);
    expect(result.current.visibleRows.some((row) => row.id === 'row-10')).toBe(true);
  });

  it('retains a fractional measured height by row identity when order changes', () => {
    const frames = animationFrames();
    try {
      const { result, rerender } = renderHook(({ visibleRows }) => useWorkspaceRowWindow(visibleRows, 'table', 0, 180, true, 'table', 'same-order'), { initialProps: { visibleRows: rows } });
      act(() => result.current.measureRow('row-0', 36.1));
      act(() => frames.flush());
      rerender({ visibleRows: [rows[1], rows[0], ...rows.slice(2)] });

      expect(result.current.offsetForRow('row-1')).toBeCloseTo(0);
      expect(result.current.offsetForRow('row-0')).toBeCloseTo(36);
      expect(result.current.offsetForRow('row-2')).toBeCloseTo(72.1);
    } finally {
      frames.restore();
    }
  });

  it('drops pending anchors when scope or order changes', () => {
    const { result, rerender } = renderHook(({ scope, orderKey, visibleRows }) => useWorkspaceRowWindow(visibleRows, 'table', 360, 180, true, scope, orderKey), { initialProps: { scope: 'table', orderKey: 'same-order', visibleRows: rows } });

    rerender({ scope: 'table', orderKey: 'changed-order', visibleRows: rows.slice(5) });
    expect(result.current.pendingScrollTop).toBeUndefined();
    rerender({ scope: 'new-table', orderKey: 'changed-order', visibleRows: rows.slice(5) });
    expect(result.current.pendingScrollTop).toBeUndefined();
  });

  it('rebases a pending anchor when the user scrolls before the measurement is applied', () => {
    const frames = animationFrames();
    try {
      const { result, rerender } = renderHook(({ top }) => useWorkspaceRowWindow(rows, 'table', top, 180, true), { initialProps: { top: 360 } });
      act(() => result.current.measureRow('row-0', 100));
      act(() => frames.flush());
      expect(result.current.pendingScrollTop).toBe(424);

      rerender({ top: 720 });
      expect(result.current.pendingScrollTop).toBe(720);

      act(() => result.current.measureRow('row-1', 100));
      act(() => frames.flush());
      expect(result.current.pendingScrollTop).toBe(784);
    } finally {
      frames.restore();
    }
  });

  it.each([
    { stickToBottom: false, expected: 3240, expectedStick: false },
    { stickToBottom: true, expected: 3304, expectedStick: true },
  ])('honors an explicit $stickToBottom bottom anchor ($expected)', ({ stickToBottom, expected, expectedStick }) => {
    const frames = animationFrames();
    try {
      const { result } = renderHook(() => useWorkspaceRowWindow(rows.slice(0, 100), 'table', 3240, 360, true, 'table', 'same-order', stickToBottom));
      act(() => result.current.measureRow('row-99', 100));
      act(() => frames.flush());
      expect(result.current.pendingScrollTop).toBe(expected);
      expect(result.current.pendingStickToBottom).toBe(expectedStick);
    } finally {
      frames.restore();
    }
  });

  it('flushes a measurement scheduled from a StrictMode layout effect after the first effect cleanup', () => {
    const frames = animationFrames();
    let layoutEffectRuns = 0;
    let latestWindow: ReturnType<typeof useWorkspaceRowWindow> | undefined;
    try {
      const Harness = () => {
        latestWindow = useWorkspaceRowWindow(rows, 'table', 0, 300, true);
        useLayoutEffect(() => { layoutEffectRuns += 1; latestWindow!.measureRow('row-0', 100); }, [latestWindow!.measureRow]);
        return null;
      };
      const view = render(<StrictMode><Harness /></StrictMode>);

      expect(layoutEffectRuns).toBeGreaterThan(1);
      expect(frames.pending).toBe(1);
      act(() => frames.flush());
      expect(latestWindow!.offsetForRow('row-1')).toBe(100);
      view.unmount();
    } finally {
      frames.restore();
    }
  });
});
