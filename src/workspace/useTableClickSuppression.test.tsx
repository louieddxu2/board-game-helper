import type { MouseEvent as ReactMouseEvent, PointerEvent } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTableGestures } from './useTableGestures';
import type { WorkspaceTable } from './types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); });

const setup = (tableId = 'table-0') => {
  const viewport = document.createElement('div');
  const table = document.createElement('table');
  viewport.append(table);
  document.body.append(viewport);
  let scrollTop = 120;
  Object.defineProperties(viewport, {
    clientHeight: { value: 100 }, scrollHeight: { value: 340 },
    clientWidth: { value: 100 }, scrollWidth: { value: 100 },
    scrollTop: { get: () => scrollTop, set: value => { scrollTop = Math.max(0, Math.min(240, value)); } },
  });
  viewport.setPointerCapture = vi.fn();

  const view = renderHook(({ activeTableId }) => useTableGestures({
    table: { id: activeTableId } as WorkspaceTable,
    data: undefined,
    commit: vi.fn(),
    setNotice: vi.fn(),
    minTextScale: 1,
    viewportRef: { current: viewport },
    workspacePageRef: { current: null },
  }), { initialProps: { activeTableId: tableId } });

  const pointerEvent = ({
    pointerType = 'touch', button = 0, pointerId = 1, clientX = 50, clientY = 200,
  }: { pointerType?: string; button?: number; pointerId?: number; clientX?: number; clientY?: number } = {}) => ({
    pointerType, button, pointerId, clientX, clientY,
    currentTarget: viewport, target: viewport, type: 'pointerup', preventDefault: vi.fn(),
  }) as unknown as PointerEvent<HTMLDivElement>;

  const touchClick = (clientX = 50, clientY = 120) => ({
    nativeEvent: { pointerType: 'touch', clientX, clientY, sourceCapabilities: { firesTouchEvents: true } },
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  }) as unknown as ReactMouseEvent<HTMLDivElement>;

  const drag = () => {
    act(() => view.result.current.beginTablePan(pointerEvent({ pointerId: 1, clientY: 200 })));
    act(() => view.result.current.moveTablePan(pointerEvent({ pointerId: 1, clientY: 120 })));
    act(() => view.result.current.endTablePan(pointerEvent({ pointerId: 1, clientY: 120 })));
  };

  const begin = (options: Parameters<typeof pointerEvent>[0] = {}) => act(() => view.result.current.beginTablePan(pointerEvent(options)));
  const end = (options: Parameters<typeof pointerEvent>[0] = {}) => act(() => view.result.current.endTablePan(pointerEvent(options)));
  const consumeTouchClick = () => {
    let consumed = false;
    act(() => { consumed = view.result.current.consumeSuppressedTableClick(touchClick()); });
    return consumed;
  };

  return {
    drag, begin, end, consumeTouchClick,
    switchTable: (nextTableId: string) => act(() => view.rerender({ activeTableId: nextTableId })),
    wait: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
  };
};

describe('table click suppression', () => {
  it('suppresses one compatibility click from a moved touch release without a new pointerdown', () => {
    const gesture = setup();
    gesture.drag();

    expect(gesture.consumeTouchClick()).toBe(true);
    expect(gesture.consumeTouchClick()).toBe(false);
  });

  it('accepts a fresh touch tap inside the release window after its pointerdown', () => {
    const gesture = setup();
    gesture.drag();
    gesture.wait(80);

    gesture.begin({ pointerId: 2, clientY: 120 });
    gesture.end({ pointerId: 2, clientY: 120 });
    expect(gesture.consumeTouchClick()).toBe(false);
  });

  it('keeps suppression when a non-primary mouse button begins', () => {
    const gesture = setup();
    gesture.drag();

    gesture.begin({ pointerType: 'mouse', button: 2, pointerId: 2 });
    expect(gesture.consumeTouchClick()).toBe(true);
  });

  it('cancels stale suppression when the active table changes', () => {
    const gesture = setup('table-0');
    gesture.drag();
    gesture.switchTable('table-1');

    expect(gesture.consumeTouchClick()).toBe(false);
  });
});
