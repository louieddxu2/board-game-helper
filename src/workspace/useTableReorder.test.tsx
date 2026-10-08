import type { RefObject } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyWorkspaceTableHistoryAction, type WorkspaceTableMutation } from './history';
import { useTableGestures } from './useTableGestures';
import { tableReorderHoldMs } from './workspaceShared';
import type { WorkspaceData, WorkspaceTable } from './types';

type GestureResult = ReturnType<typeof useTableGestures>;
type Commit = Parameters<typeof useTableGestures>[0]['commit'];
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
