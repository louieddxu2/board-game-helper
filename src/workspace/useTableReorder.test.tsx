import type { RefObject } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyWorkspaceTableHistoryAction, type WorkspaceTableMutation } from './history';
import { DRAG_SCROLL_DWELL_MS } from './useDragEdgeAutoScroll';
import { useTableGestures } from './useTableGestures';
import { useTableReorder } from './useTableReorder';
import { tableReorderHoldMs } from './workspaceShared';
import type { WorkspaceData, WorkspaceTable } from './types';

type GestureResult = ReturnType<typeof useTableGestures>;
type Commit = Parameters<typeof useTableGestures>[0]['commit'];
type ReorderOptions = Parameters<typeof useTableReorder>[0];
type ReorderResult = ReturnType<typeof useTableReorder>;
type ReorderKind = 'row' | 'column';

const makeFixture = () => {
  const rows = [
    { id: 'row-1', name: '第一筆', values: { 'column-1': '甲', 'column-2': '一' } },
    { id: 'row-2', name: '第二筆', values: { 'column-1': '乙', 'column-2': '二' } },
    { id: 'row-3', name: '第三筆', values: { 'column-1': '丙', 'column-2': '三' } },
  ];
  const columns = [
    { id: 'column-1', name: '第一欄', inputType: 'text' as const, options: [] },
    { id: 'column-2', name: '第二欄', inputType: 'text' as const, options: [] },
    { id: 'column-3', name: '第三欄', inputType: 'text' as const, options: [] },
  ];
  const table: WorkspaceTable = {
    id: 'table-1', name: '拖曳測試', rowHeaderName: '物件',
    rowHeader: { id: 'row-header-table-1', name: '物件', inputType: 'text', options: [] }, columns, rows, updatedAt: 1,
  };
  const data: WorkspaceData = {
    version: 1, activeNodeId: 'node-1', tables: [table],
    nodes: [{ id: 'node-1', type: 'table', name: table.name, parentId: null, order: 0, tableId: table.id }],
  };
  return { table, data };
};

const makeEvent = (viewport: HTMLDivElement, clientX: number, clientY: number) => ({
  pointerType: 'touch', button: 0, pointerId: 7, clientX, clientY,
  currentTarget: viewport, target: viewport, preventDefault: vi.fn(),
});

const makeTarget = (kind: ReorderKind, id?: string) => {
  const target = document.createElement('div');
  if (kind === 'row' && id) target.dataset.rowId = id;
  if (kind === 'column' && id) target.dataset.columnId = id;
  target.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 } as DOMRect);
  return target;
};

const makeReorderOptions = (tableId: string, data: WorkspaceData, overrides: Partial<ReorderOptions> = {}) => {
  const viewport = document.createElement('div');
  const commit = vi.fn<ReorderOptions['commit']>();
  const setNotice = vi.fn();
  const onActivate = vi.fn();
  const onFinish = vi.fn();
  const options: ReorderOptions = {
    tableId, data, commit, setNotice, onActivate, onFinish,
    viewportRef: { current: viewport } as RefObject<HTMLDivElement | null>,
    ...overrides,
  };
  return { options, viewport, commit, onActivate, onFinish };
};

const renderReorder = (options: ReorderOptions) => renderHook((current: ReorderOptions) => useTableReorder(current), { initialProps: options });

const makeDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const makeScrollableViewport = (viewport: HTMLDivElement) => {
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 100 },
    clientHeight: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 400 },
  });
  viewport.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 } as DOMRect);
  const setPointerCapture = vi.fn<(pointerId: number) => void>();
  const hasPointerCapture = vi.fn(() => true);
  const releasePointerCapture = vi.fn<(pointerId: number) => void>();
  viewport.setPointerCapture = setPointerCapture;
  viewport.hasPointerCapture = hasPointerCapture;
  viewport.releasePointerCapture = releasePointerCapture;
  return { setPointerCapture, releasePointerCapture };
};

const beginReorderAndHold = (view: { result: { current: ReorderResult } }, viewport: HTMLDivElement, kind: ReorderKind = 'row', sourceId = 'row-1') => {
  const begin = makeEvent(viewport, 10, 10) as unknown as Parameters<ReorderResult['beginTableReorder']>[2];
  act(() => {
    view.result.current.beginTableReorder(kind, sourceId, begin);
    vi.advanceTimersByTime(tableReorderHoldMs);
  });
};

const renderGestures = (table: WorkspaceTable, data: WorkspaceData, commit: Commit) => {
  const viewport = document.createElement('div');
  const workspacePage = document.createElement('main');
  const view = renderHook(() => useTableGestures({
    table, data, commit,
    viewportRef: { current: viewport } as RefObject<HTMLDivElement | null>,
    workspacePageRef: { current: workspacePage } as RefObject<HTMLElement | null>,
    setNotice: vi.fn(), minTextScale: 1,
  }));
  return { view, viewport };
};

const drag = (view: { result: { current: GestureResult } }, viewport: HTMLDivElement, kind: ReorderKind, sourceId: string, target: HTMLElement) => {
  const begin = makeEvent(viewport, 10, 10) as unknown as Parameters<GestureResult['beginTableReorder']>[2];
  const move = makeEvent(viewport, 80, 80) as unknown as Parameters<GestureResult['moveTableReorder']>[0];
  const end = makeEvent(viewport, 80, 80) as unknown as Parameters<GestureResult['endTableReorder']>[0];
  const previousElementFromPoint = document.elementFromPoint;
  document.elementFromPoint = vi.fn(() => target);
  try {
    act(() => {
      view.result.current.beginTableReorder(kind, sourceId, begin);
      vi.advanceTimersByTime(tableReorderHoldMs);
    });
    act(() => {
      view.result.current.moveTableReorder(move);
      view.result.current.endTableReorder(end);
    });
  } finally {
    document.elementFromPoint = previousElementFromPoint;
  }
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('live table reorder gestures', () => {
  it.each([
    { kind: 'row' as const, sourceId: 'row-1', targetId: 'row-3', expectedIds: ['row-2', 'row-3', 'row-1'], label: '重新排列物件' },
    { kind: 'column' as const, sourceId: 'column-1', targetId: 'column-3', expectedIds: ['column-2', 'column-3', 'column-1'], label: '重新排列屬性' },
  ])('commits a $kind reorder and its history action supports undo and redo', (scenario) => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const commit = vi.fn<Commit>();
    const { view, viewport } = renderGestures(table, data, commit);
    const target = makeTarget(scenario.kind, scenario.targetId);

    drag(view, viewport, scenario.kind, scenario.sourceId, target);

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextData, mutation] = commit.mock.calls[0] as [WorkspaceData, WorkspaceTableMutation];
    expect(mutation).toMatchObject({ tableId: table.id, label: scenario.label });
    expect(mutation.action).toEqual({
      type: scenario.kind === 'row' ? 'reorder-rows' : 'reorder-columns',
      beforeIds: scenario.kind === 'row' ? ['row-1', 'row-2', 'row-3'] : ['column-1', 'column-2', 'column-3'],
      afterIds: scenario.expectedIds,
    });
    const nextTable = nextData.tables[0];
    const nextItems = scenario.kind === 'row' ? nextTable.rows : nextTable.columns;
    expect(nextItems.map(item => item.id)).toEqual(scenario.expectedIds);
    if (scenario.kind === 'row') {
      expect(nextTable.rows[0]).toBe(table.rows[1]);
      expect(nextTable.rows[0].values).toBe(table.rows[1].values);
      expect(nextTable.rows[2]).toBe(table.rows[0]);
      expect(nextTable.columns).toBe(table.columns);
    } else {
      expect(nextTable.columns[0]).toBe(table.columns[1]);
      expect(nextTable.columns[2]).toBe(table.columns[0]);
      expect(nextTable.rows).toBe(table.rows);
    }
    expect(table.rows.map(row => row.id)).toEqual(['row-1', 'row-2', 'row-3']);

    const undoneData = applyWorkspaceTableHistoryAction(nextData, table.id, mutation.action, 'undo');
    const undone = undoneData.tables[0];
    const redone = applyWorkspaceTableHistoryAction(undoneData, table.id, mutation.action, 'redo').tables[0];
    expect((scenario.kind === 'row' ? undone.rows : undone.columns).map(item => item.id)).toEqual(scenario.kind === 'row' ? ['row-1', 'row-2', 'row-3'] : ['column-1', 'column-2', 'column-3']);
    expect((scenario.kind === 'row' ? redone.rows : redone.columns).map(item => item.id)).toEqual(scenario.expectedIds);
    if (scenario.kind === 'row') expect(redone.rows[2].values).toBe(table.rows[0].values);
  });

  it.each([
    { kind: 'row' as const, sourceId: 'row-2', targetId: 'row-1' },
    { kind: 'column' as const, sourceId: 'column-2', targetId: 'column-1' },
    { kind: 'row' as const, sourceId: 'row-1', targetId: 'missing-row' },
    { kind: 'column' as const, sourceId: 'column-1', targetId: 'missing-column' },
  ])('does not commit a same-order or missing-$kind target drag', (scenario) => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const commit = vi.fn<Commit>();
    const { view, viewport } = renderGestures(table, data, commit);
    drag(view, viewport, scenario.kind, scenario.sourceId, makeTarget(scenario.kind, scenario.targetId));

    expect(commit).not.toHaveBeenCalled();
  });
});

describe('table reorder readiness and cancellation', () => {
  it.each(['switch', 'unmount'] as const)('ignores delayed readiness after a table %s', async (mode) => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const ready = makeDeferred<void>();
    const { options, viewport, commit, onActivate } = makeReorderOptions(table.id, data, { ensureTableReady: () => ready.promise });
    const { setPointerCapture } = makeScrollableViewport(viewport);
    const view = renderReorder(options);

    beginReorderAndHold(view, viewport);
    if (mode === 'switch') view.rerender({ ...options, tableId: 'table-2' });
    else view.unmount();

    await act(async () => {
      ready.resolve();
      await ready.promise;
      await flushMicrotasks();
    });
    expect(onActivate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it('activates with the latest hydrated data after readiness', async () => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const hydratedData: WorkspaceData = {
      ...data,
      tables: [{
        ...table,
        rows: table.rows.map(row => ({ ...row, values: { ...row.values, 'column-1': `hydrated-${row.id}` } })),
        updatedAt: 9,
      }],
    };
    const ready = makeDeferred<void>();
    const { options, viewport, commit, onActivate } = makeReorderOptions(table.id, data, { ensureTableReady: () => ready.promise });
    const view = renderReorder(options);
    beginReorderAndHold(view, viewport);
    view.rerender({ ...options, data: hydratedData });

    await act(async () => {
      ready.resolve();
      await ready.promise;
      await flushMicrotasks();
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    const target = makeTarget('row', 'row-3');
    const previousElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => target);
    try {
      act(() => {
        const move = makeEvent(viewport, 80, 80) as unknown as Parameters<ReorderResult['moveTableReorder']>[0];
        const end = makeEvent(viewport, 80, 80) as unknown as Parameters<ReorderResult['endTableReorder']>[0];
        view.result.current.moveTableReorder(move);
        view.result.current.endTableReorder(end);
      });
    } finally {
      document.elementFromPoint = previousElementFromPoint;
    }
    expect(commit).toHaveBeenCalledTimes(1);
    const [nextData] = commit.mock.calls[0] as [WorkspaceData];
    expect(nextData.tables[0].rows.map(row => row.id)).toEqual(['row-2', 'row-3', 'row-1']);
    expect(nextData.tables[0].rows[0].values['column-1']).toBe('hydrated-row-2');
  });

  it.each(['switch', 'unmount'] as const)('does not report a stale readiness rejection after a table %s', async (mode) => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const ready = makeDeferred<void>();
    const error = new Error('stale read');
    const onReadError = vi.fn();
    const { options, viewport } = makeReorderOptions(table.id, data, { ensureTableReady: () => ready.promise, onReadError });
    const view = renderReorder(options);

    beginReorderAndHold(view, viewport);
    if (mode === 'switch') view.rerender({ ...options, tableId: 'table-2' });
    else view.unmount();
    await act(async () => {
      ready.reject(error);
      await ready.promise.catch(() => undefined);
      await flushMicrotasks();
    });

    expect(onReadError).not.toHaveBeenCalled();
  });

  it('reports one current readiness rejection and clears the pending reorder', async () => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const ready = makeDeferred<void>();
    const error = new Error('current read');
    const onReadError = vi.fn();
    const { options, viewport, commit } = makeReorderOptions(table.id, data, { ensureTableReady: () => ready.promise, onReadError });
    const view = renderReorder(options);

    beginReorderAndHold(view, viewport);
    await act(async () => {
      ready.reject(error);
      await ready.promise.catch(() => undefined);
      await flushMicrotasks();
    });
    expect(onReadError).toHaveBeenCalledTimes(1);
    expect(onReadError).toHaveBeenCalledWith(error);
    expect(view.result.current.tableReorderVisual).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(['switch', 'unmount'] as const)('stops active edge scrolling and releases capture on table %s', (mode) => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const { options, viewport } = makeReorderOptions(table.id, data);
    const { releasePointerCapture } = makeScrollableViewport(viewport);
    const view = renderReorder(options);
    beginReorderAndHold(view, viewport);

    const target = makeTarget('row', 'row-2');
    const previousElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => target);
    try {
      act(() => {
        const move = makeEvent(viewport, 50, 95) as unknown as Parameters<ReorderResult['moveTableReorder']>[0];
        view.result.current.moveTableReorder(move);
      });
      expect(viewport.dataset.dragScrollEdge).toBe('bottom');
      act(() => { vi.advanceTimersByTime(DRAG_SCROLL_DWELL_MS + 20); });
      expect(viewport.dataset.dragScrollActive).toBe('true');
      expect(viewport.scrollTop).toBeGreaterThan(0);

      const stoppedScrollTop = viewport.scrollTop;
      const replacementViewport = document.createElement('div');
      if (mode === 'switch') {
        makeScrollableViewport(replacementViewport);
        view.rerender({
          ...options,
          tableId: 'table-2',
          viewportRef: { current: replacementViewport } as RefObject<HTMLDivElement | null>,
        });
      } else view.unmount();
      expect(viewport.dataset.dragScrollEdge).toBeUndefined();
      expect(viewport.dataset.dragScrollActive).toBeUndefined();
      expect(releasePointerCapture).toHaveBeenCalledWith(7);
      const replacementScrollTop = replacementViewport.scrollTop;
      act(() => { vi.advanceTimersByTime(1000); });
      expect(viewport.scrollTop).toBe(stoppedScrollTop);
      if (mode === 'switch') expect(replacementViewport.scrollTop).toBe(replacementScrollTop);
    } finally {
      document.elementFromPoint = previousElementFromPoint;
    }
  });

  it('cancels without committing after the target changes', () => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const { options, viewport, commit, onFinish } = makeReorderOptions(table.id, data);
    const { setPointerCapture, releasePointerCapture } = makeScrollableViewport(viewport);
    const view = renderReorder(options);
    beginReorderAndHold(view, viewport);

    const target = makeTarget('row', 'row-3');
    const previousElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => target);
    try {
      act(() => {
        const move = makeEvent(viewport, 80, 80) as unknown as Parameters<ReorderResult['moveTableReorder']>[0];
        view.result.current.moveTableReorder(move);
      });
    } finally {
      document.elementFromPoint = previousElementFromPoint;
    }
    expect(view.result.current.tableReorderVisual).toMatchObject({ targetId: 'row-3', after: true });

    act(() => {
      const cancel = { ...makeEvent(viewport, 80, 80), type: 'pointercancel' } as unknown as Parameters<ReorderResult['endTableReorder']>[0];
      view.result.current.endTableReorder(cancel);
    });
    expect(commit).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(view.result.current.tableReorderVisual).toBeUndefined();
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('cancels a pending hold before readiness or activation', () => {
    vi.useFakeTimers();
    const { table, data } = makeFixture();
    const ensureTableReady = vi.fn(() => Promise.resolve());
    const { options, viewport, commit, onActivate } = makeReorderOptions(table.id, data, { ensureTableReady });
    const view = renderReorder(options);

    act(() => {
      const begin = makeEvent(viewport, 10, 10) as unknown as Parameters<ReorderResult['beginTableReorder']>[2];
      view.result.current.beginTableReorder('row', 'row-1', begin);
    });
    act(() => {
      const move = makeEvent(viewport, 20, 20) as unknown as Parameters<ReorderResult['moveTableReorder']>[0];
      view.result.current.moveTableReorder(move);
      vi.advanceTimersByTime(tableReorderHoldMs);
    });
    expect(ensureTableReady).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
