import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  maintainWorkspaceRowPages: vi.fn(async () => undefined),
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


const longPress = async (target: Element) => {
    const dispatchPointer = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 });
      Object.defineProperties(event, { pointerId: { value: 17 }, pointerType: { value: 'mouse' } });
      fireEvent(target, event);
    };
    dispatchPointer('pointerdown');
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    dispatchPointer('pointerup');
    fireEvent.click(target);
  };

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

describe('WorkspacePage.touch', () => {
it('adds and cancels the current table in the bottom navigation', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    await user.click(screen.getByRole('button', { name: '開啟測試表格操作' }));
    await user.click(screen.getByRole('button', { name: '加入底部導覽列' }));

    expect(await screen.findByRole('navigation', { name: '常用表格' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開啟表格 測試表格' })).toHaveAttribute('aria-current', 'page');
    expect(vi.mocked(saveWorkspace)).toHaveBeenLastCalledWith(expect.objectContaining({ bottomNavigationTableIds: ['table-1'] }), expect.objectContaining({ history: expect.any(Object) }));

    await user.click(screen.getByRole('button', { name: '開啟目錄' }));
    await user.click(screen.getByRole('button', { name: '管理底部導覽列' }));
    await user.click(screen.getByRole('button', { name: '取消導覽' }));
    fireEvent.click(document.querySelector('.workspace-bottom-navigation-dialog-overlay')!);

    expect(screen.queryByRole('navigation', { name: '常用表格' })).not.toBeInTheDocument();
    expect(vi.mocked(saveWorkspace)).toHaveBeenLastCalledWith(expect.objectContaining({ bottomNavigationTableIds: [] }), expect.objectContaining({ history: expect.any(Object) }));
  });

it('releases the bottom navigation height while the virtual keyboard is open', async () => {
    const previousVisualViewport = window.visualViewport;
    const previousInnerHeight = window.innerHeight;
    const visualViewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, width: 390, height: 800 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const user = userEvent.setup();

    try {
      render(<WorkspacePage />);
      await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
      await user.click(screen.getByRole('button', { name: '開啟測試表格操作' }));
      await user.click(screen.getByRole('button', { name: '加入底部導覽列' }));
      expect(await screen.findByRole('navigation', { name: '常用表格' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '搜尋' }));
      expect(screen.getByRole('searchbox', { name: '搜尋此表' })).toHaveFocus();
      visualViewport.height = 360;
      act(() => visualViewport.dispatchEvent(new Event('resize')));
      await waitFor(() => expect(screen.queryByRole('navigation', { name: '常用表格' })).not.toBeInTheDocument());

      visualViewport.height = 800;
      act(() => visualViewport.dispatchEvent(new Event('resize')));
      await waitFor(() => expect(screen.getByRole('navigation', { name: '常用表格' })).toBeInTheDocument());
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousInnerHeight });
    }
  });

it('selects same-property cells by long press and commits one shared value', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));

    const first = screen.getByRole('cell', { name: '花火，名稱：空白' });
    const second = screen.getByRole('cell', { name: '物件 2，名稱：空白' });
    await longPress(first);
    const bulkToolbar = screen.getByRole('toolbar', { name: '批次編輯 名稱' });
    expect(bulkToolbar).toHaveTextContent('已選 1 格');
    expect(within(bulkToolbar).getByText('批次')).toBeInTheDocument();
    expect(within(bulkToolbar).queryByText('設定內容')).not.toBeInTheDocument();
    expect(document.querySelector('.workspace-toolbar-layer')).toHaveStyle({ '--workspace-toolbar-row-count': '1' });
    expect(screen.queryByRole('button', { name: '輸入至已選方格' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');
    expect(screen.getByRole('status')).toHaveTextContent('只能選取同一屬性');
    await user.click(second);
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 2 格');

    await user.click(screen.getByRole('button', { name: '開啟 名稱 批次輸入' }));
    await user.type(screen.getByRole('textbox', { name: '名稱批次輸入' }), '共同內容');
    expect(screen.getByRole('button', { name: '確認' })).toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.queryByText('共同內容')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '開啟 名稱 批次輸入' }));
    await user.type(screen.getByRole('textbox', { name: '名稱批次輸入' }), '共同內容');
    await user.click(screen.getByRole('button', { name: '確認' }));

    expect(screen.getAllByText('共同內容')).toHaveLength(2);
    expect(screen.queryByRole('toolbar', { name: '批次編輯 名稱' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '復原' }));
    expect(screen.queryByText('共同內容')).not.toBeInTheDocument();
  });

it('sweeps across same-column rows, fills skipped rows, then permits a guard-band swipe from that column', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: '編輯' }));
    for (let index = 0; index < 3; index += 1) await user.click(screen.getByRole('button', { name: '新增物件' }));
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const source = screen.getByRole('cell', { name: '花火，名稱：空白' });
    const second = screen.getByRole('cell', { name: '物件 2，名稱：空白' });
    const fourth = screen.getByRole('cell', { name: '物件 4，名稱：空白' });
    source.getBoundingClientRect = () => ({ left: 100, right: 180, top: 80, bottom: 120, width: 80, height: 40, x: 100, y: 80, toJSON: () => ({}) });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn((_x, y) => y >= 160 ? fourth : second);
    try {
      dispatchTouchPointer(source, 'pointerdown', 140, 100, 81);
      await waitFor(() => expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格'));
      expect(source).toHaveClass('is-bulk-column');
      expect(second).toHaveClass('is-bulk-column');
      expect(screen.getByRole('cell', { name: '物件 2，數量：空白' })).not.toHaveClass('is-bulk-column');
      dispatchTouchPointer(viewport, 'pointermove', 145, 180, 81);
      expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 4 格');
      dispatchTouchPointer(viewport, 'pointermove', 145, 130, 81);
      expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 4 格');
      dispatchTouchPointer(viewport, 'pointerup', 145, 130, 81);

      viewport.scrollTop = 100;
      dispatchTouchPointer(source, 'pointerdown', 105, 100, 82);
      dispatchTouchPointer(viewport, 'pointermove', 105, 50, 82);
      expect(viewport.scrollTop).toBe(150);
      expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 4 格');
      dispatchTouchPointer(viewport, 'pointerup', 105, 50, 82);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }
  });

it('treats the column guard bands and a two-to-one diagonal as table drags after a hold', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const source = screen.getByRole('cell', { name: '花火，名稱：空白' });
    source.getBoundingClientRect = () => ({ left: 100, right: 180, top: 80, bottom: 120, width: 80, height: 40, x: 100, y: 80, toJSON: () => ({}) });
    dispatchTouchPointer(source, 'pointerdown', 105, 100, 83);
    await waitFor(() => expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格'));
    viewport.scrollTop = 100;
    dispatchTouchPointer(viewport, 'pointermove', 105, 150, 83);
    expect(viewport.scrollTop).toBe(50);
    dispatchTouchPointer(viewport, 'pointerup', 105, 150, 83);

    dispatchTouchPointer(source, 'pointerdown', 140, 100, 84);
    viewport.scrollTop = 100;
    dispatchTouchPointer(viewport, 'pointermove', 155, 135, 84);
    expect(viewport.scrollTop).toBe(65);
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');
    dispatchTouchPointer(viewport, 'pointerup', 155, 135, 84);
  });

it('changes a held sweep into a pan when the finger leaves the central lane', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const source = screen.getByRole('cell', { name: '花火，名稱：空白' });
    const second = screen.getByRole('cell', { name: '物件 2，名稱：空白' });
    source.getBoundingClientRect = () => ({ left: 100, right: 180, top: 80, bottom: 120, width: 80, height: 40, x: 100, y: 80, toJSON: () => ({}) });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => second);
    try {
      dispatchTouchPointer(source, 'pointerdown', 140, 100, 85);
      await waitFor(() => expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格'));
      dispatchTouchPointer(viewport, 'pointermove', 140, 130, 85);
      expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 2 格');
      viewport.scrollTop = 100;
      dispatchTouchPointer(viewport, 'pointermove', 176, 140, 85);
      expect(viewport.scrollTop).toBe(100);
      dispatchTouchPointer(viewport, 'pointermove', 176, 100, 85);
      expect(viewport.scrollTop).toBe(140);
      dispatchTouchPointer(viewport, 'pointermove', 140, 60, 85);
      expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 2 格');
      dispatchTouchPointer(viewport, 'pointerup', 140, 60, 85);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }
  });

it('toggles a same-column cell on a central touch tap without another long press', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    const source = screen.getByRole('cell', { name: '花火，名稱：空白' });
    const second = screen.getByRole('cell', { name: '物件 2，名稱：空白' });
    const otherColumn = screen.getByRole('cell', { name: '物件 2，數量：空白' });
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    second.getBoundingClientRect = () => ({ left: 100, right: 180, top: 120, bottom: 160, width: 80, height: 40, x: 100, y: 120, toJSON: () => ({}) });
    await longPressWithoutSyntheticClick(source);

    dispatchTouchPointer(second, 'pointerdown', 140, 140, 86);
    dispatchTouchPointer(viewport, 'pointerup', 140, 140, 86);
    fireEvent.click(second, { clientX: 140, clientY: 140 });
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 2 格');

    dispatchTouchPointer(second, 'pointerdown', 140, 140, 87);
    dispatchTouchPointer(viewport, 'pointerup', 140, 140, 87);
    fireEvent.click(second, { clientX: 140, clientY: 140 });
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');

    dispatchTouchPointer(second, 'pointerdown', 140, 140, 92);
    dispatchTouchPointer(viewport, 'pointermove', 140, 155, 92);
    dispatchTouchPointer(viewport, 'pointerup', 140, 155, 92);
    fireEvent.click(second, { clientX: 140, clientY: 155 });
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');

    dispatchTouchPointer(second, 'pointerdown', 105, 140, 88);
    dispatchTouchPointer(viewport, 'pointerup', 105, 140, 88);
    fireEvent.click(second, { clientX: 105, clientY: 140 });
    dispatchTouchPointer(otherColumn, 'pointerdown', 140, 140, 89);
    dispatchTouchPointer(viewport, 'pointerup', 140, 140, 89);
    fireEvent.click(otherColumn, { clientX: 140, clientY: 140 });
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');
  });

it('starts a same-column touch sweep immediately after multi-selection is active', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: '編輯' }));
    for (let index = 0; index < 3; index += 1) await user.click(screen.getByRole('button', { name: '新增物件' }));
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const source = screen.getByRole('cell', { name: '花火，名稱：空白' });
    const second = screen.getByRole('cell', { name: '物件 2，名稱：空白' });
    const fourth = screen.getByRole('cell', { name: '物件 4，名稱：空白' });
    second.getBoundingClientRect = () => ({ left: 100, right: 180, top: 120, bottom: 160, width: 80, height: 40, x: 100, y: 120, toJSON: () => ({}) });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => fourth);
    try {
      await longPressWithoutSyntheticClick(source);
      viewport.scrollTop = 100;
      dispatchTouchPointer(second, 'pointerdown', 140, 140, 90);
      dispatchTouchPointer(viewport, 'pointermove', 145, 210, 90);
      dispatchTouchPointer(viewport, 'pointerup', 145, 210, 90);
      fireEvent.click(second, { clientX: 145, clientY: 210 });
      expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 4 格');
      expect(viewport.scrollTop).toBe(100);
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }
  });
});
