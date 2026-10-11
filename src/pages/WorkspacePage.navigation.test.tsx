import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  loadWorkspaceHistoryHead: vi.fn(async (tableId: string) => ({ tableId, past: [], future: [] })),
  loadWorkspaceHistoryEntry: vi.fn(async () => { throw new Error('history entry not seeded'); }),
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
describe('WorkspacePage.navigation', () => {
it('shows the table name and only add and settings actions in the app bar', async () => {
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByText('測試表格')).toBeInTheDocument());
    const actions = document.querySelector('.workspace-appbar-actions')!;
    expect([...actions.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['搜尋', '編輯', '設定']);
  });

it('adds objects and attributes without opening an editor and reports both with toast messages', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '編輯' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增屬性' }));
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('已新增屬性');
    expect(toast).toHaveClass('workspace-appbar-notice');
    expect(toast.closest('.workspace-appbar')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: /屬性 5/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新增物件' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已新增物件');
    expect(screen.getByRole('row', { name: /物件 2/ })).toBeInTheDocument();
  });

it('expands the mobile quick-action panel and keeps its four actions connected to table history', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const collapsedPanel = await screen.findByRole('button', { name: '展開快速操作' });
    expect(collapsedPanel).toHaveAttribute('aria-expanded', 'false');
    expect(collapsedPanel.parentElement).toHaveClass('workspace-quick-actions');
    expect(collapsedPanel.parentElement?.parentElement).toHaveClass('workspace-table-viewport');

    await user.click(collapsedPanel);
    const toolbar = screen.getByRole('toolbar', { name: '快速操作' });
    const addRow = within(toolbar).getByRole('button', { name: '新增列' });
    const undo = within(toolbar).getByRole('button', { name: '上一動' });
    const redo = within(toolbar).getByRole('button', { name: '下一動' });
    const addColumn = within(toolbar).getByRole('button', { name: '新增欄' });
    expect([addRow, undo, redo, addColumn].map((button) => button.getAttribute('aria-label'))).toEqual(['新增列', '上一動', '下一動', '新增欄']);
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    expect(within(toolbar).queryByRole('button', { name: '貼上多格' })).not.toBeInTheDocument();

    await user.click(addRow);
    expect(screen.getByRole('row', { name: /物件 2/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(undo).not.toBeDisabled();
    expect(screen.getByRole('toolbar', { name: '快速操作' })).toBeInTheDocument();

    await user.click(undo);
    expect(screen.queryByRole('row', { name: /物件 2/ })).not.toBeInTheDocument();
    expect(redo).not.toBeDisabled();
    await user.click(redo);
    expect(screen.getByRole('row', { name: /物件 2/ })).toBeInTheDocument();

    await user.click(addColumn);
    expect(screen.getByRole('columnheader', { name: /屬性 5/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '收合快速操作' }));
    expect(screen.getByRole('button', { name: '展開快速操作' })).toBeInTheDocument();
  });

it('reveals newly added objects and attributes in the table', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增屬性' }));
    expect(document.querySelector('.workspace-table thead th.workspace-context-active')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新增物件' }));
    expect(document.querySelector('.workspace-row-heading.workspace-context-active')).toBeInTheDocument();
  });

it('undoes and redoes a cell edit from the table edit bar', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，名稱：空白' });
    await user.click(cell);
    await user.type(screen.getByRole('textbox'), '改名');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.getByText('改名')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '編輯' }));
    const undo = screen.getByRole('button', { name: '復原' });
    const redo = screen.getByRole('button', { name: '重做' });
    expect(undo).not.toBeDisabled();
    expect(redo).toBeDisabled();
    await user.click(undo);
    expect(screen.queryByText('改名')).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument();
    expect(redo).not.toBeDisabled();
    await user.click(redo);
    expect(screen.getByText('改名')).toBeInTheDocument();
  });

it('clears redo after a new table edit', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，名稱：空白' });
    await user.click(cell);
    await user.type(screen.getByRole('textbox'), '第一次');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '復原' }));
    expect(screen.getByRole('button', { name: '重做' })).not.toBeDisabled();

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox'), '第二次');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();
  });

it('edits the table name by clicking the displayed table title', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '重新命名表格' }));
    const input = screen.getByRole('textbox', { name: '名稱' });
    await user.clear(input);
    await user.type(input, '新表格名稱');
    fireEvent.click(document.querySelector('.workspace-name-dialog-overlay')!);
    expect(screen.getByText('新表格名稱')).toBeInTheDocument();
  });

it('visibly marks the cell or column currently being edited', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，名稱：空白' });
    await user.click(cell);
    expect(cell).toHaveClass('is-editing');
    await user.keyboard('{Escape}');

    const column = screen.getByRole('columnheader', { name: '名稱' });
    await user.click(column);
    expect(column).toHaveClass('is-editing');
  });

it('highlights the active object and property context while editing a cell', async () => {
    render(<WorkspacePage />);
    await waitFor(() => expect(document.querySelector('[data-cell-id="row-1:column-text"]')).not.toBeNull());

    const cell = document.querySelector('[data-cell-id="row-1:column-text"]') as HTMLElement;
    fireEvent.click(cell);

    expect(cell).toHaveClass('is-editing');
    expect(document.querySelector('[data-row-id="row-1"]')).toHaveClass('workspace-context-active');
    expect(document.querySelector('[data-column-id="column-text"]')).toHaveClass('workspace-context-active');
  });

it('saves a column text alignment and applies it to its cells', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const header = await screen.findByRole('columnheader', { name: '名稱' });
    expect(header).toHaveStyle({ textAlign: 'center' });
    await user.click(header);
    await user.click(screen.getByRole('button', { name: '置右' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    await waitFor(() => expect(document.querySelector('.workspace-column-dialog-overlay')).toBeNull());
    expect(screen.getByRole('columnheader', { name: '名稱' })).toHaveStyle({ textAlign: 'center' });
    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toHaveStyle({ textAlign: 'right' });
  });

it('does not delete rows or attributes from a context menu gesture', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('cell', { name: '花火，名稱：空白' });
    const row = document.querySelector('[data-row-id="row-1"]')!;
    const column = document.querySelector('[data-column-id="column-text"]')!;
    fireEvent.contextMenu(row);
    fireEvent.contextMenu(column);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row).toBeInTheDocument();
    expect(column).toBeInTheDocument();
  });

it('keeps ordinary mouse-wheel scrolling available without changing text scale', async () => {
    render(<WorkspacePage />);
    await screen.findByRole('table');
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 });
    fireEvent(viewport, wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(viewport.scrollTop).toBe(0);
    expect(screen.getByRole('table')).toHaveStyle({ '--workspace-text-scale': '1' });
  });

it('offers move-to instead of an already implicit open-table action', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    await user.click(screen.getByRole('button', { name: '開啟測試表格操作' }));
    expect(screen.queryByRole('button', { name: '開啟表格' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '移動至' }));
    expect(screen.getByRole('button', { name: '收藏資料夾' })).toBeInTheDocument();
  });

it('moves a drawer item into a folder after a long-press drag', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const source = screen.getAllByText('測試表格').find((element) => element.classList.contains('workspace-tree-name-text'))!.closest('.workspace-tree-row')!;
    const target = screen.getByText('收藏資料夾').closest('.workspace-tree-row')!;
    const tree = document.querySelector('.workspace-tree')!;
    const previousElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => target);
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 8 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    try {
      dispatchPointer(source, 'pointerdown', 30, 80);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      dispatchPointer(tree, 'pointermove', 30, 140);
      dispatchPointer(tree, 'pointerup', 30, 140);
      await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'node-table', parentId: 'folder-1' })]),
      }), expect.objectContaining({ history: expect.any(Object) })));
    } finally {
      document.elementFromPoint = previousElementFromPoint;
    }
  });

it('offers blank-table creation and single-table import from the drawer create action', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    await user.click(screen.getByRole('button', { name: '新增表格' }));
    const input = document.querySelector('#workspace-import-table') as HTMLInputElement & { showPicker?: () => void };
    const showPicker = vi.fn();
    input.showPicker = showPicker;

    await user.click(screen.getByRole('button', { name: '匯入單表' }));

    expect(showPicker).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

it('keeps the drawer open when an active item drag moves horizontally', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const source = screen.getAllByText('測試表格').find((element) => element.classList.contains('workspace-tree-name-text'))!.closest('.workspace-tree-row')!;
    const target = screen.getByText('收藏資料夾').closest('.workspace-tree-row')!;
    const tree = document.querySelector('.workspace-tree')!;
    const previousElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => target);
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 32 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    try {
      dispatchPointer(source, 'pointerdown', 320, 80);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      fireEvent.contextMenu(source);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      const nativeTouchMove = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(nativeTouchMove, 'touches', { value: [{ identifier: 32, clientX: 40, clientY: 82 }] });
      fireEvent(tree, nativeTouchMove);
      expect(nativeTouchMove.defaultPrevented).toBe(false);
      dispatchPointer(tree, 'pointermove', 40, 82);
      dispatchPointer(tree, 'pointerup', 40, 82);

      await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'node-table', parentId: 'folder-1' })]),
      }), expect.objectContaining({ history: expect.any(Object) })));
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      expect(screen.getByRole('complementary', { name: 'Workspace 目錄' })).toBeInTheDocument();
    } finally {
      document.elementFromPoint = previousElementFromPoint;
    }
  });

it('shows local save and backup status in the drawer', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    expect(within(drawer).getByText(/已儲存於此裝置/)).toBeInTheDocument();
    expect(within(drawer).getByText('尚未匯出資料')).toHaveClass('needs-attention');
  });

it('provides one persisted automatic backup toggle in the drawer', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const toggle = within(screen.getByRole('complementary', { name: 'Workspace 目錄' })).getByRole('checkbox', { name: '自動備份' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(window.localStorage.getItem('board-game-helper-google-drive-auto-backup')).toBe('true');
  });

it('closes the drawer when a child control consumes the left-swipe pointer events', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    const start = within(drawer).getByRole('button', { name: '開啟測試表格操作' });
    const consumePointerEvent = (event: Event) => event.stopPropagation();
    start.addEventListener('pointermove', consumePointerEvent);
    start.addEventListener('pointerup', consumePointerEvent);
    const dispatchPointer = (element: Element, type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 100 });
      Object.defineProperties(event, { pointerId: { value: 31 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    dispatchPointer(start, 'pointerdown', 320);
    dispatchPointer(start, 'pointermove', 40);
    dispatchPointer(start, 'pointerup', 40);

    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Workspace 目錄' })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

it('closes the drawer from a touch pointer swipe on a tree row', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const row = screen.getAllByText('測試表格').find((element) => element.classList.contains('workspace-tree-name-text'))!.closest('.workspace-tree-row')!;

    const dispatchPointer = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 160 });
      Object.defineProperties(event, { pointerId: { value: 41 }, pointerType: { value: 'touch' } });
      fireEvent(row, event);
    };
    dispatchPointer('pointerdown', 320);
    dispatchPointer('pointermove', 40);
    dispatchPointer('pointerup', 40);

    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Workspace 目錄' })).not.toBeInTheDocument());
  });

it('does not swallow the first drawer item click after reopening from a touch close', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    const row = screen.getAllByText('測試表格').find((element) => element.classList.contains('workspace-tree-name-text'))!.closest('.workspace-tree-row')!;

    const dispatchPointer = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 160 });
      Object.defineProperties(event, { pointerId: { value: 51 }, pointerType: { value: 'touch' } });
      fireEvent(row, event);
    };
    dispatchPointer('pointerdown', 320);
    dispatchPointer('pointermove', 40);
    dispatchPointer('pointerup', 40);
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Workspace 目錄' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '開啟目錄' }));
    const reopenedDrawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    await user.click(within(reopenedDrawer).getByText('測試表格'));

    expect(screen.queryByRole('complementary', { name: 'Workspace 目錄' })).not.toBeInTheDocument();
  });

it('does not swallow the first drawer item click after reopening by table swipe', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    const drawerRow = screen.getAllByText('測試表格').find((element) => element.classList.contains('workspace-tree-name-text'))!.closest('.workspace-tree-row')!;

    const dispatchClosePointer = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 160 });
      Object.defineProperties(event, { pointerId: { value: 61 }, pointerType: { value: 'touch' } });
      fireEvent(drawerRow, event);
    };
    dispatchClosePointer('pointerdown', 320);
    dispatchClosePointer('pointermove', 40);
    dispatchClosePointer('pointerup', 40);
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Workspace 目錄' })).not.toBeInTheDocument());

    const viewport = document.querySelector('.workspace-table-viewport')!;
    const firstColumn = document.querySelector('[data-row-id="row-1"]')!;
    const dispatchPointer = (element: Element, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 62 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    dispatchPointer(firstColumn, 'pointerdown', 90, 40);
    dispatchPointer(viewport, 'pointermove', 130, 40);
    expect(screen.getByRole('complementary', { name: 'Workspace 目錄' })).toBeInTheDocument();
    dispatchPointer(viewport, 'pointerup', 130, 40);

    await user.click(within(screen.getByRole('complementary', { name: 'Workspace 目錄' })).getByText('測試表格'));
    expect(screen.queryByRole('complementary', { name: 'Workspace 目錄' })).not.toBeInTheDocument();
  });

it('marks 返回網站 as an explicit homepage navigation in installed mode', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(display-mode: standalone)' } as MediaQueryList)));
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));

    fireEvent.click(screen.getByRole('link', { name: '返回網站' }));

    expect(window.localStorage.getItem('wrong-board-game-pwa-last-route')).toBe('/');
  });

it('opens Google Drive backup settings from one status entry in the drawer', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const drawerButton = await screen.findByRole('button', { name: '開啟目錄' });
    await user.click(drawerButton);
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    expect(within(drawer).getByRole('button', { name: '開啟 Google Drive 備份' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Google Drive 備份' })).not.toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: '開啟 Google Drive 備份' }));
    expect(screen.getByRole('dialog', { name: 'Google Drive 備份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連結 Google Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即備份' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Workspace 目錄' })).not.toBeInTheDocument();
  });

it('searches tables and folders from the drawer', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    const search = within(drawer).getByRole('searchbox', { name: '搜尋表格與資料夾' });

    await user.type(search, '收藏');
    expect(within(drawer).getByText('收藏資料夾')).toBeInTheDocument();
    expect(within(drawer).queryByText('測試表格')).not.toBeInTheDocument();
    await user.clear(search);
    expect(within(drawer).getByText('測試表格')).toBeInTheDocument();
  });

it('restores a table search when returning to the workspace', async () => {
    const user = userEvent.setup();
    const firstRender = render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '搜尋' }));
    await user.type(screen.getByRole('searchbox', { name: '搜尋此表' }), '花火');
    firstRender.unmount();

    render(<WorkspacePage />);
    expect(await screen.findByRole('searchbox', { name: '搜尋此表' })).toHaveValue('花火');
  });
});
