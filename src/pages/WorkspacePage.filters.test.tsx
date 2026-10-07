import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveWorkspace } from '../workspace/db';
import { WorkspacePage } from './WorkspacePage';
vi.mock('../workspace/db', () => {
  const loadWorkspace = async () => ({
    version: 1,
    activeNodeId: 'node-table',
    nodes: [
      { id: 'node-table', type: 'table', name: '測試表格', parentId: null, order: 0, tableId: 'table-1' },
      { id: 'folder-1', type: 'folder', name: '收藏資料夾', parentId: null, order: 1 },
    ],
    tables: [{
      id: 'table-1', name: '測試表格', rowHeaderName: '物件', updatedAt: 0,
      columns: [
        { id: 'column-text', name: '名稱', inputType: 'text', options: [] },
        { id: 'column-number', name: '數量', inputType: 'number', options: [] },
        { id: 'column-select', name: '類型', inputType: 'select', options: ['合作', '競爭'] },
        { id: 'column-dynamic', name: '標籤', inputType: 'dynamic-select', options: [] },
      ],
      rows: [{ id: 'row-1', name: '花火', values: { 'column-text': null, 'column-number': 2, 'column-select': '合作', 'column-dynamic': null } }],
    }],
  });
  return {
  loadWorkspace,
  loadWorkspaceInitial: async () => ({ data: await loadWorkspace(), complete: true, storageVersion: 4 }),
  assertWorkspaceStorageCurrent: vi.fn(async () => undefined),
  saveWorkspace: vi.fn(async () => undefined),
  loadWorkspaceHistories: vi.fn(async () => new Map()),
};
});

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(saveWorkspace).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const longPressWithoutSyntheticClick = async (target: Element) => {
    const dispatchPointer = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 });
      Object.defineProperties(event, { pointerId: { value: 19 }, pointerType: { value: 'touch' } });
      fireEvent(target, event);
    };
    dispatchPointer('pointerdown');
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    dispatchPointer('pointerup');
  };

const dispatchTouchPointer = (target: Element, type: string, x: number, y: number, pointerId: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: 'touch' } });
    fireEvent(target, event);
  };

describe('WorkspacePage.filters', () => {
it('searches every value in the active table without changing the app-bar actions', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '搜尋' }));

    const search = screen.getByRole('searchbox', { name: '搜尋此表' });
    await user.type(search, '合作');
    expect(screen.getByRole('row', { name: /花火/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '不存在');
    expect(screen.queryByRole('row', { name: /花火/ })).not.toBeInTheDocument();
    expect(document.querySelector('.workspace-filterbar-count')).not.toBeInTheDocument();
    expect(document.querySelector('.workspace-appbar-search-count')).toHaveTextContent('0 / 1');
    expect([...document.querySelectorAll('.workspace-appbar-actions button')].map((btn) => btn.getAttribute('aria-label'))).toEqual(['搜尋', '編輯', '設定']);
  });

it('moves search into the title slot and uses the second row for column filters', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    expect(document.querySelector('.workspace-filterbar')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '搜尋' }));

    expect(screen.getByRole('searchbox', { name: '搜尋此表' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新命名表格' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除搜尋與篩選' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '關閉搜尋' })).not.toBeInTheDocument();
    expect(document.querySelector('.workspace-appbar-search svg')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.workspace-filterbar-button')).toHaveLength(5);
    expect(document.querySelector('.workspace-filterbar-count')).not.toBeInTheDocument();
    expect((document.querySelector('.workspace-filterbar-scroll') as HTMLElement).style.gridTemplateColumns.split(' ')).toHaveLength(5);
    expect((document.querySelector('.workspace-filterbar-scroll') as HTMLElement).style.width).not.toBe('');
    expect(document.querySelector('.workspace-filterbar-button.is-frozen')).toBe(document.querySelector('.workspace-filterbar-button'));
    expect([...document.querySelectorAll('.workspace-filterbar-button')].every((button) => !button.textContent?.includes('物件') && !button.textContent?.includes('名稱'))).toBe(true);

    await user.type(screen.getByRole('searchbox', { name: '搜尋此表' }), '合作');
    await user.click(screen.getByRole('button', { name: '清除搜尋與篩選' }));

    expect(screen.queryByRole('searchbox', { name: '搜尋此表' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開啟目錄' })).toBeInTheDocument();
  });

it('filters, sorts, and searches values from every first-row header', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));
    await user.type(screen.getByRole('spinbutton'), '10');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    await user.click(screen.getByRole('button', { name: '搜尋' }));
    expect(screen.getAllByRole('button', { name: /^篩選 / })).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: '篩選 數量' }));
    expect(screen.getByRole('dialog', { name: '篩選 數量' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '屬性設定' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
    expect(screen.getAllByRole('spinbutton')[0]).toHaveAttribute('value', '');
    expect(screen.getAllByRole('spinbutton')[1]).toHaveAttribute('value', '');
    expect(screen.getByText('目前符合 2 筆')).toBeInTheDocument();
    expect(screen.getByLabelText('數量總和')).toHaveTextContent('12');

    await user.click(screen.getByRole('button', { name: '降冪' }));
    fireEvent.click(document.querySelector('.workspace-filter-dialog-overlay')!);
    expect([...document.querySelectorAll('.workspace-table tbody tr')].map((row) => row.textContent)).toEqual([
      expect.stringContaining('物件 2'),
      expect.stringContaining('花火'),
    ]);

    await user.click(screen.getByRole('button', { name: '篩選 數量' }));
    const rangeInputs = screen.getAllByRole('spinbutton');
    await user.type(rangeInputs[0], '5');
    await user.type(rangeInputs[1], '10');
    expect(screen.getByText('目前符合 1 筆')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '平均' }));
    expect(screen.getByLabelText('數量平均')).toHaveTextContent('10');
    fireEvent.click(document.querySelector('.workspace-filter-dialog-overlay')!);
    expect(screen.queryByRole('row', { name: /花火/ })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /物件 2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '篩選 數量' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '篩選 數量' })).toHaveTextContent('5～10');
  });

it('searches text filter values without option checkboxes', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '搜尋' }));
    await user.click(await screen.findByRole('button', { name: '篩選 物件' }));

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: '搜尋物件的值' });
    await user.type(search, '花');
    expect(screen.getByRole('row', { name: /花火/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /物件 2/ })).not.toBeInTheDocument();
  });

it('does not expose the unfinished transpose control', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '設定' }));
    expect(screen.getByRole('button', { name: '匯出此表' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '欄位顯示設定' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '轉置顯示' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢復正常顯示' })).not.toBeInTheDocument();
  });

it('auto-scrolls the drawer tree while a dragged item is held near an edge', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const source = screen.getAllByText('測試表格').find((element) => element.classList.contains('workspace-tree-name-text'))!.closest('.workspace-tree-row')!;
    const tree = document.querySelector('.workspace-tree') as HTMLDivElement;
    Object.defineProperties(tree, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, writable: true, value: 40 },
    });
    tree.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: 0, toJSON: () => ({}) });
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const previousCancelAnimationFrame = window.cancelAnimationFrame;
    let animationFrame: FrameRequestCallback | undefined;
    window.requestAnimationFrame = vi.fn((callback) => { animationFrame = callback; return 1; });
    window.cancelAnimationFrame = vi.fn();
    const dispatchPointer = (element: Element, type: string, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 30, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 18 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    try {
      dispatchPointer(source, 'pointerdown', 80);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      dispatchPointer(tree, 'pointermove', 195);
      expect(animationFrame).toBeTypeOf('function');
      animationFrame?.(0);
      expect(tree.scrollTop).toBeGreaterThan(40);
      dispatchPointer(tree, 'pointerup', 195);
    } finally {
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;
    }
  });

it('reorders attributes and items with a long-press drag', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport')!;
    const previousElementFromPoint = document.elementFromPoint;
    const dispatchPointer = (element: Element, type: string, x: number, y: number, pointerId: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    try {
      const sourceColumn = document.querySelector('[data-column-id="column-text"]')!;
      const targetColumn = document.querySelector('[data-column-id="column-number"]')!;
      document.elementFromPoint = vi.fn(() => targetColumn);
      dispatchPointer(sourceColumn, 'pointerdown', 100, 40, 10);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      dispatchPointer(viewport, 'pointermove', 220, 40, 10);
      dispatchPointer(viewport, 'pointerup', 220, 40, 10);
      await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
        tables: expect.arrayContaining([expect.objectContaining({
          columns: expect.arrayContaining([expect.objectContaining({ id: 'column-number' })]),
        })]),
      }), expect.objectContaining({ history: expect.any(Object) })));
      const latestColumnSave = vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0];
      expect(latestColumnSave?.tables[0].columns.slice(0, 2).map((column) => column.id)).toEqual(['column-number', 'column-text']);

      await user.click(screen.getByRole('button', { name: '編輯' }));
      await user.click(screen.getByRole('button', { name: '新增物件' }));
      const sourceRow = document.querySelector('[data-row-id="row-1"]')!;
      const targetRow = document.querySelectorAll('[data-row-id]')[1];
      document.elementFromPoint = vi.fn(() => targetRow);
      dispatchPointer(sourceRow, 'pointerdown', 40, 100, 11);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      dispatchPointer(viewport, 'pointermove', 40, 220, 11);
      dispatchPointer(viewport, 'pointerup', 40, 220, 11);
      await waitFor(() => expect(vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0].tables[0].rows[1].id).toBe('row-1'));
    } finally {
      document.elementFromPoint = previousElementFromPoint;
    }
  });

it('auto-scrolls the table viewport when a reorder reaches an edge', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const source = document.querySelector('[data-column-id="column-text"]')!;
    const target = document.querySelector('[data-column-id="column-number"]')!;
    const previousElementFromPoint = document.elementFromPoint;
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const previousCancelAnimationFrame = window.cancelAnimationFrame;
    let animationFrame: FrameRequestCallback | undefined;
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 19 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTop: { configurable: true, writable: true, value: 40 },
    });
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 400, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) });
    document.elementFromPoint = vi.fn(() => target);
    window.requestAnimationFrame = vi.fn((callback) => { animationFrame = callback; return 1; });
    window.cancelAnimationFrame = vi.fn();

    try {
      dispatchPointer(source, 'pointerdown', 100, 40);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      dispatchPointer(viewport, 'pointermove', 395, 295);
      expect(viewport.scrollLeft).toBe(0);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      animationFrame?.(0);
      expect(viewport.scrollLeft).toBeGreaterThan(0);
      expect(viewport.scrollTop).toBe(40);
    } finally {
      dispatchPointer(viewport, 'pointerup', 395, 150);
      document.elementFromPoint = previousElementFromPoint;
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;
    }
  });

it('does not auto-scroll when a reorder starts at the edge and only jitters after pickup', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const source = document.querySelector('[data-column-id="column-text"]')!;
    const previousElementFromPoint = document.elementFromPoint;
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const previousCancelAnimationFrame = window.cancelAnimationFrame;
    let animationFrame: FrameRequestCallback | undefined;
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 29 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 400, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) });
    document.elementFromPoint = vi.fn(() => source);
    window.requestAnimationFrame = vi.fn((callback) => { animationFrame = callback; return 1; });
    window.cancelAnimationFrame = vi.fn();

    try {
      dispatchPointer(source, 'pointerdown', 395, 40);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      dispatchPointer(viewport, 'pointermove', 398, 40);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      animationFrame?.(0);
      expect(viewport.scrollLeft).toBe(0);
    } finally {
      dispatchPointer(viewport, 'pointerup', 398, 40);
      document.elementFromPoint = previousElementFromPoint;
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;
    }
  });

it('only auto-scrolls vertically while an object is being reordered', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const source = document.querySelector('[data-row-id="row-1"]')!;
    const previousElementFromPoint = document.elementFromPoint;
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const previousCancelAnimationFrame = window.cancelAnimationFrame;
    let animationFrame: FrameRequestCallback | undefined;
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 23 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 40 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 400, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) });
    document.elementFromPoint = vi.fn(() => source);
    window.requestAnimationFrame = vi.fn((callback) => { animationFrame = callback; return 1; });
    window.cancelAnimationFrame = vi.fn();

    try {
      dispatchPointer(source, 'pointerdown', 40, 100);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      dispatchPointer(viewport, 'pointermove', 395, 295);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      animationFrame?.(0);
      expect(viewport.scrollLeft).toBe(40);
      expect(viewport.scrollTop).toBeGreaterThan(0);
    } finally {
      dispatchPointer(viewport, 'pointerup', 395, 295);
      document.elementFromPoint = previousElementFromPoint;
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;
    }
  });

it('opens the drawer from a rightward swipe started anywhere in the first column', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport')!;
    const firstColumn = document.querySelector('[data-row-id="row-1"]')! as HTMLElement;
    firstColumn.getBoundingClientRect = () => ({ top: 0, bottom: 80, left: 0, right: 100, width: 100, height: 80, x: 0, y: 0, toJSON: () => ({}) });
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 31 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    dispatchPointer(firstColumn, 'pointerdown', 90, 40);
    dispatchPointer(viewport, 'pointermove', 130, 40);
    expect(screen.getByRole('complementary', { name: 'Workspace 目錄' })).toBeInTheDocument();
    dispatchPointer(viewport, 'pointerup', 130, 40);
  });

it('opens the drawer from a rightward swipe started in the empty viewport area', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport')!;
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 34 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    dispatchPointer(viewport, 'pointerdown', 320, 220);
    dispatchPointer(viewport, 'pointermove', 360, 220);
    expect(screen.getByRole('complementary', { name: 'Workspace 目錄' })).toBeInTheDocument();
    dispatchPointer(viewport, 'pointerup', 360, 220);
  });

it('opens search after holding a vertical boundary bounce for half a second', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const cell = document.querySelector('[data-cell-id="row-1:column-text"]')!;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 32 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    dispatchPointer(cell, 'pointerdown', 120, 100);
    dispatchPointer(viewport, 'pointermove', 120, 220);
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    expect(screen.getByRole('searchbox', { name: '搜尋此表' })).toBeInTheDocument();
    dispatchPointer(viewport, 'pointerup', 120, 220);
  });

it('opens search after holding a vertical boundary bounce at the bottom edge', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const cell = document.querySelector('[data-cell-id="row-1:column-text"]')!;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTop: { configurable: true, writable: true, value: 300 },
    });
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 33 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    dispatchPointer(cell, 'pointerdown', 120, 220);
    dispatchPointer(viewport, 'pointermove', 120, 100);
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    expect(screen.getByRole('searchbox', { name: '搜尋此表' })).toBeInTheDocument();
    dispatchPointer(viewport, 'pointerup', 120, 100);
  });

it('does not open search from an upward boundary pull during multi-selection', async () => {
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，名稱：空白' });
    await longPressWithoutSyntheticClick(cell);
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTop: { configurable: true, writable: true, value: 300 },
    });

    vi.useFakeTimers();
    try {
      dispatchTouchPointer(cell, 'pointerdown', 120, 220, 91);
      dispatchTouchPointer(viewport, 'pointermove', 120, 100, 91);
      act(() => vi.advanceTimersByTime(600));
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');
      dispatchTouchPointer(viewport, 'pointerup', 120, 100, 91);
    } finally {
      vi.useRealTimers();
    }
  });
});
