import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceData } from './types';
import { Tree } from './workspaceSidebar';

const data: WorkspaceData = {
  version: 1,
  activeNodeId: null,
  nodes: [
    { id: 'table-a-node', type: 'table', name: '表格 A', parentId: null, order: 0, tableId: 'table-a' },
    { id: 'table-b-node', type: 'table', name: '表格 B', parentId: null, order: 1, tableId: 'table-b' },
  ],
  tables: [],
};

const dispatchPointer = (element: Element, type: string, pointerId = 41, clientX = 30, clientY = 80) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: 'touch' } });
  fireEvent(element, event);
};

describe('workspace directory tree', () => {
  afterEach(() => vi.useRealTimers());

  it('opens another item immediately after a long-press drag without relying on a synthesized click', () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const onMove = vi.fn();
    const view = render(<Tree data={data} expanded={new Set()} onToggle={vi.fn()} onContext={vi.fn()} onOpen={onOpen} onMove={onMove} />);
    const source = view.container.querySelector<HTMLElement>('[data-node-id="table-a-node"]')!;
    const target = view.getByText('表格 B').closest('.workspace-tree-row')!;
    const tree = view.container.querySelector('.workspace-tree')!;
    const previousElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => target);

    try {
      dispatchPointer(source, 'pointerdown');
      vi.advanceTimersByTime(460);
      dispatchPointer(tree, 'pointermove');
      dispatchPointer(tree, 'pointerup');
      dispatchPointer(target, 'pointerdown', 42);
      dispatchPointer(target, 'pointerup', 42);
      expect(onOpen).not.toHaveBeenCalled();
      fireEvent.click(target);
      expect(onOpen).not.toHaveBeenCalled();
      vi.runOnlyPendingTimers();
      expect(onOpen).toHaveBeenCalledWith(data.nodes[1]);
      expect(onOpen).toHaveBeenCalledTimes(1);
    } finally {
      document.elementFromPoint = previousElementFromPoint;
    }
  });

  it('does not activate a drawer item when a left swipe reaches pointerup without an item-level move', () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const view = render(<Tree data={data} expanded={new Set()} onToggle={vi.fn()} onContext={vi.fn()} onOpen={onOpen} onMove={vi.fn()} />);
    const source = view.container.querySelector<HTMLElement>('[data-node-id="table-a-node"]')!;

    dispatchPointer(source, 'pointerdown', 51, 320, 80);
    dispatchPointer(source, 'pointerup', 51, 40, 82);
    vi.runOnlyPendingTimers();

    expect(onOpen).not.toHaveBeenCalled();
  });
});
