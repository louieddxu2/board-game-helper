import type { MouseEvent as ReactMouseEvent, PointerEvent } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useTableGestures } from './useTableGestures';
import { tableReorderHoldMs } from './workspaceShared';
import type { WorkspaceTable } from './types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); });

type PointerOptions = {
  pointerType?: string;
  button?: number;
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  target?: Element;
};

const CELL_RECT = {
  left: 100, right: 180, top: 100, bottom: 140, width: 80, height: 40,
  x: 100, y: 100, toJSON: () => ({}),
} as DOMRect;

const makeCell = (rowId: string, columnId: string) => {
  const cell = document.createElement('td');
  cell.dataset.bulkRowId = rowId;
  cell.dataset.bulkColumnId = columnId;
  cell.getBoundingClientRect = () => CELL_RECT;
  return cell;
};

const makeHeader = ({ rowId, columnId, className }: { rowId?: string; columnId?: string; className?: string }) => {
  const header = document.createElement('th');
  if (rowId) header.dataset.rowId = rowId;
  if (columnId) header.dataset.columnId = columnId;
  if (className) header.className = className;
  header.getBoundingClientRect = () => CELL_RECT;
  return header;
};

const makeTouchClick = (clientX = 140, clientY = 120) => ({
  nativeEvent: { pointerType: 'touch', clientX, clientY, sourceCapabilities: { firesTouchEvents: true } },
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
}) as unknown as ReactMouseEvent<HTMLDivElement>;

const setup = ({ includeLongPress = true }: { includeLongPress?: boolean } = {}) => {
  const viewport = document.createElement('div');
  const tableElement = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const cornerHeading = makeHeader({ className: 'workspace-row-corner' });
  const columnHeading = makeHeader({ columnId: 'column-1' });
  headRow.append(cornerHeading, columnHeading);
  head.append(headRow);
  const body = document.createElement('tbody');
  const row = document.createElement('tr');
  const rowHeading = makeHeader({ rowId: 'row-1', className: 'workspace-row-heading' });
  const cell = makeCell('row-1', 'column-1');
  const secondCell = makeCell('row-2', 'column-1');
  row.append(rowHeading, cell, secondCell);
  body.append(row);
  tableElement.append(head, body);
  viewport.append(tableElement);
  document.body.append(viewport);

  let scrollLeft = 0;
  let scrollTop = 120;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 100 },
    clientHeight: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 400 },
    scrollLeft: { configurable: true, get: () => scrollLeft, set: (value: number) => { scrollLeft = value; } },
    scrollTop: { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } },
  });
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = vi.fn(() => false);
  viewport.releasePointerCapture = vi.fn();

  const onCellLongPress = vi.fn();
  const onCellTap = vi.fn();
  const onHeaderTap = vi.fn();
  const view = renderHook(({ tableId }: { tableId: string }) => useTableGestures({
    table: { id: tableId } as WorkspaceTable,
    data: undefined,
    commit: vi.fn(),
    viewportRef: { current: viewport },
    workspacePageRef: { current: null },
    setNotice: vi.fn(),
    minTextScale: 1,
    onCellLongPress: includeLongPress ? onCellLongPress : undefined,
    onCellTap,
    onHeaderTap,
  }), { initialProps: { tableId: 'table-1' } });

  const makePointerEvent = (type: string, {
    pointerType = 'touch', button = 0, pointerId = 1, clientX = 140, clientY = 120,
    target = cell,
  }: PointerOptions = {}) => ({
    pointerType, button, pointerId, clientX, clientY,
    currentTarget: viewport, target, type, preventDefault: vi.fn(),
  }) as unknown as PointerEvent<HTMLDivElement>;

  const call = (kind: 'begin' | 'move' | 'end', options: PointerOptions = {}) => {
    let event!: PointerEvent<HTMLDivElement>;
    act(() => {
      event = makePointerEvent(kind === 'end' ? 'pointerup' : `pointer${kind}`, options);
      if (kind === 'begin') view.result.current.beginTablePan(event);
      else if (kind === 'move') view.result.current.moveTablePan(event);
      else view.result.current.endTablePan(event);
    });
    return event;
  };

  const cancel = (options: PointerOptions = {}) => {
    let event!: PointerEvent<HTMLDivElement>;
    act(() => {
      event = makePointerEvent('pointercancel', options);
      view.result.current.endTablePan(event);
    });
    return event;
  };

  const tap = (options: PointerOptions = {}) => {
    call('begin', options);
    return call('end', options);
  };

  const moveAndRelease = (pointerId = 1) => {
    call('begin', { pointerId });
    call('move', { pointerId, target: viewport, clientY: 155 });
    return call('end', { pointerId, target: viewport, clientY: 155 });
  };

  const consumeTouchClick = () => {
    let consumed = false;
    act(() => { consumed = view.result.current.consumeSuppressedTableClick(makeTouchClick()); });
    return consumed;
  };

  return {
    view,
    viewport,
    tableElement,
    cell,
    secondCell,
    rowHeading,
    columnHeading,
    cornerHeading,
    onCellLongPress,
    onCellTap,
    onHeaderTap,
    call,
    tap,
    cancel,
    moveAndRelease,
    consumeTouchClick,
    beginHeaderReorder: (kind: 'row' | 'column', target: HTMLTableCellElement) => {
      const event = makePointerEvent('pointerdown', { target });
      const sourceId = kind === 'row' ? target.dataset.rowId! : target.dataset.columnId!;
      act(() => {
        view.result.current.beginTableReorder(kind, sourceId, event);
        view.result.current.beginTablePan(event);
      });
      return event;
    },
    switchTable: (tableId: string) => act(() => view.rerender({ tableId })),
    wait: (ms: number) => act(() => vi.advanceTimersByTime(ms)),
  };
};

describe('useTableGestures semantic touch taps', () => {
  test.each([
    ['row', 'rowHeading', { kind: 'row', id: 'row-1' }],
    ['column', 'columnHeading', { kind: 'column', id: 'column-1' }],
    ['corner', 'cornerHeading', { kind: 'corner' }],
  ] as const)('invokes the %s header tap once and consumes its compatibility click', (_name, targetKey, expected) => {
    const gesture = setup();

    gesture.tap({ target: gesture[targetKey] });

    expect(gesture.onHeaderTap).toHaveBeenCalledTimes(1);
    expect(gesture.onHeaderTap).toHaveBeenCalledWith(expected);
    expect(gesture.consumeTouchClick()).toBe(true);
    expect(gesture.consumeTouchClick()).toBe(false);
    expect(gesture.onHeaderTap).toHaveBeenCalledTimes(1);
  });

  test.each(['movement', 'cancel', 'pinch'] as const)('does not invoke a header tap after %s', (failure) => {
    const gesture = setup();

    if (failure === 'movement') {
      gesture.call('begin', { target: gesture.rowHeading });
      gesture.call('move', { target: gesture.viewport, clientY: 155 });
      gesture.call('end', { target: gesture.viewport, clientY: 155 });
    } else if (failure === 'cancel') {
      gesture.call('begin', { target: gesture.columnHeading });
      gesture.cancel({ target: gesture.columnHeading });
    } else {
      gesture.call('begin', { pointerId: 1, target: gesture.rowHeading });
      gesture.call('begin', { pointerId: 2, target: gesture.secondCell, clientY: 130 });
      gesture.call('end', { pointerId: 1, target: gesture.rowHeading });
      gesture.call('end', { pointerId: 2, target: gesture.secondCell, clientY: 130 });
    }

    expect(gesture.onHeaderTap).not.toHaveBeenCalled();
  });

  test('clears a pending header tap when the table changes and ignores links inside a header', () => {
    const gesture = setup();
    const link = document.createElement('a');
    link.href = '#details';
    gesture.columnHeading.append(link);

    gesture.tap({ target: link });
    expect(gesture.onHeaderTap).not.toHaveBeenCalled();

    gesture.call('begin', { target: gesture.rowHeading });
    gesture.switchTable('table-2');
    gesture.call('end', { target: gesture.rowHeading });
    expect(gesture.onHeaderTap).not.toHaveBeenCalled();
  });

  test.each(['row', 'column'] as const)('keeps a %s header long press in reorder behavior, then accepts the next tap', kind => {
    const gesture = setup();
    const heading = kind === 'row' ? gesture.rowHeading : gesture.columnHeading;
    const down = gesture.beginHeaderReorder(kind, heading);
    gesture.wait(tableReorderHoldMs);
    expect(gesture.view.result.current.tableReorderVisual?.kind).toBe(kind);

    let handled = false;
    act(() => { handled = gesture.view.result.current.endTableReorder({ ...down, type: 'pointerup' }); });
    expect(handled).toBe(true);
    expect(gesture.onHeaderTap).not.toHaveBeenCalled();

    gesture.tap({ pointerId: 2, target: heading });
    expect(gesture.onHeaderTap).toHaveBeenCalledTimes(1);
  });

  test('allows a direct body-cell touch when long-press behavior is not supplied', () => {
    const gesture = setup({ includeLongPress: false });

    gesture.tap();

    expect(gesture.onCellTap).toHaveBeenCalledTimes(1);
    expect(gesture.onCellTap).toHaveBeenCalledWith('row-1', 'column-1');
  });

  test('invokes onCellTap once for a stationary connected body-cell touch without a click', () => {
    const gesture = setup();

    const end = gesture.tap();

    expect(gesture.onCellTap).toHaveBeenCalledTimes(1);
    expect(gesture.onCellTap).toHaveBeenCalledWith('row-1', 'column-1');
    expect(gesture.onCellLongPress).not.toHaveBeenCalled();
    expect(end.preventDefault).not.toHaveBeenCalled();
  });

  test('allows a fresh cell tap during the moved-touch compatibility-click window', () => {
    const gesture = setup();
    gesture.moveAndRelease();
    gesture.wait(100);

    gesture.tap({ pointerId: 2 });

    expect(gesture.onCellTap).toHaveBeenCalledTimes(1);
    expect(gesture.onCellTap).toHaveBeenCalledWith('row-1', 'column-1');
  });

  test('consumes the direct tap compatibility click once and allows the next touch tap', () => {
    const gesture = setup();

    gesture.tap({ pointerId: 1 });
    expect(gesture.onCellTap).toHaveBeenCalledTimes(1);
    expect(gesture.consumeTouchClick()).toBe(true);
    expect(gesture.consumeTouchClick()).toBe(false);
    expect(gesture.onCellTap).toHaveBeenCalledTimes(1);

    gesture.tap({ pointerId: 2 });
    expect(gesture.onCellTap).toHaveBeenCalledTimes(2);
  });

  test('never taps a moved touch release', () => {
    const gesture = setup();

    gesture.moveAndRelease();

    expect(gesture.onCellTap).not.toHaveBeenCalled();
  });

  test('blocks a compatibility click retargeted to the new editor but accepts the next fresh gesture', () => {
    const gesture = setup();
    const backdrop = document.createElement('div');
    const closeEditor = vi.fn();
    backdrop.addEventListener('click', closeEditor);
    document.body.append(backdrop);
    gesture.tap();
    const click = () => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 140, clientY: 120 });

    const compatibilityMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, clientX: 140, clientY: 120 });
    backdrop.dispatchEvent(compatibilityMouseDown);
    expect(compatibilityMouseDown.defaultPrevented).toBe(true);
    const compatibilityClick = click();
    backdrop.dispatchEvent(compatibilityClick);
    expect(compatibilityClick.defaultPrevented).toBe(true);
    expect(closeEditor).not.toHaveBeenCalled();

    backdrop.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const freshMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 1, clientX: 140, clientY: 120 });
    backdrop.dispatchEvent(freshMouseDown);
    expect(freshMouseDown.defaultPrevented).toBe(false);
    backdrop.dispatchEvent(click());
    expect(closeEditor).toHaveBeenCalledTimes(1);
  });

  test('does not consume a fresh gesture outside the table when no compatibility click arrived', () => {
    const gesture = setup();
    gesture.tap();
    const button = document.createElement('button');
    const activate = vi.fn();
    button.addEventListener('click', activate);
    document.body.append(button);

    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 140, clientY: 120 }));

    expect(activate).toHaveBeenCalledTimes(1);
  });

  test('never taps a cancelled touch pointer', () => {
    const gesture = setup();

    gesture.call('begin');
    const end = gesture.cancel();

    expect(gesture.onCellTap).not.toHaveBeenCalled();
    expect(end.preventDefault).not.toHaveBeenCalled();
  });

  test.each([true, false])('never taps a pinch when long-press behavior is %s, even after one finger lifts', (includeLongPress) => {
    const gesture = setup({ includeLongPress });

    gesture.call('begin', { pointerId: 1, target: gesture.cell });
    gesture.call('begin', { pointerId: 2, target: gesture.secondCell, clientY: 130 });
    gesture.call('end', { pointerId: 1, target: gesture.cell });
    expect(gesture.onCellTap).not.toHaveBeenCalled();
    gesture.call('end', { pointerId: 2, target: gesture.secondCell, clientY: 130 });

    expect(gesture.onCellTap).not.toHaveBeenCalled();
  });

  test.each(['a', 'button'])('keeps an external %s target native', (tagName) => {
    const gesture = setup();
    const control = document.createElement(tagName);
    control.textContent = tagName;
    gesture.cell.append(control);

    const end = gesture.tap({ target: control });

    expect(gesture.onCellTap).not.toHaveBeenCalled();
    expect(end.preventDefault).not.toHaveBeenCalled();
  });

  test('keeps mouse taps native', () => {
    const gesture = setup();

    const end = gesture.tap({ pointerType: 'mouse' });

    expect(gesture.onCellTap).not.toHaveBeenCalled();
    expect(end.preventDefault).not.toHaveBeenCalled();
  });

  test('keeps a long press in bulk-selection behavior instead of ordinary tap behavior', () => {
    const gesture = setup();
    gesture.call('begin');
    gesture.wait(tableReorderHoldMs);

    const end = gesture.call('end');

    expect(gesture.onCellLongPress).toHaveBeenCalledTimes(1);
    expect(gesture.onCellLongPress).toHaveBeenCalledWith('row-1', 'column-1');
    expect(gesture.onCellTap).not.toHaveBeenCalled();
    expect(end.preventDefault).toHaveBeenCalled();
  });

  test('cancels a pending tap when the active table changes', () => {
    const gesture = setup();
    gesture.call('begin');
    gesture.switchTable('table-2');
    gesture.call('end');

    expect(gesture.onCellTap).not.toHaveBeenCalled();
    expect(gesture.onCellLongPress).not.toHaveBeenCalled();
  });

  test('does not activate a detached attributed cell', () => {
    const gesture = setup();
    const detachedCell = makeCell('detached-row', 'column-1');

    const end = gesture.tap({ target: detachedCell });

    expect(gesture.onCellTap).not.toHaveBeenCalled();
    expect(end.preventDefault).not.toHaveBeenCalled();
  });
});
