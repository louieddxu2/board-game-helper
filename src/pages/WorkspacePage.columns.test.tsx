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
describe('WorkspacePage.columns', () => {
it('keeps item names and the item axis separate from attribute columns', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '編輯物件 花火' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '編輯物件 花火' }));
    const itemName = screen.getByRole('textbox', { name: '物件名稱' });
    await user.clear(itemName);
    await user.type(itemName, '收藏清單第一項');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.getByRole('button', { name: '編輯物件 收藏清單第一項' })).toBeInTheDocument();

    await user.click(screen.getByRole('columnheader', { name: '物件' }));
    const axisName = screen.getByRole('textbox', { name: '屬性名稱' });
    await user.clear(axisName);
    await user.type(axisName, '桌遊收藏');
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    await waitFor(() => expect(document.querySelector('.workspace-column-dialog-overlay')).toBeNull());
    expect(screen.getByRole('button', { name: '桌遊收藏' })).toBeInTheDocument();
  });

it('opens header editors when the header cell itself is clicked', async () => {
    render(<WorkspacePage />);
    await waitFor(() => expect(document.querySelector('.workspace-row-heading')).not.toBeNull());

    fireEvent.click(document.querySelector('.workspace-row-heading')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    fireEvent.click(document.querySelectorAll('.workspace-table thead th')[1]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

it('allows intentional line breaks in item and column headers', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '編輯物件 花火' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '編輯物件 花火' }));
    await user.clear(screen.getByRole('textbox', { name: '物件名稱' }));
    await user.type(screen.getByRole('textbox', { name: '物件名稱' }), '收藏{Enter}第一項');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.getByRole('button', { name: /編輯物件 收藏\s+第一項/ }).textContent).toBe('收藏\n第一項');

    await user.click(screen.getByRole('button', { name: '名稱' }));
    const columnName = screen.getByRole('textbox', { name: '屬性名稱' });
    await user.clear(columnName);
    await user.type(columnName, '桌遊{Enter}名稱');
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    await waitFor(() => expect(document.querySelector('.workspace-column-dialog-overlay')).toBeNull());
    expect(screen.getAllByRole('button', { name: /桌遊\s+名稱/ }).find((button) => button.classList.contains('workspace-column-name'))?.textContent).toBe('桌遊\n名稱');
  });

it('preserves fixed options while trying other input types', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '類型' }));
    expect(screen.getByRole('textbox', { name: '固定選項 1' })).toHaveValue('合作');
    expect(screen.getByRole('textbox', { name: '固定選項 2' })).toHaveValue('競爭');

    await user.selectOptions(screen.getByRole('combobox', { name: '輸入類型' }), 'text');
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    await waitFor(() => expect(document.querySelector('.workspace-column-dialog-overlay')).toBeNull());
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
      tables: expect.arrayContaining([expect.objectContaining({
        columns: expect.arrayContaining([expect.objectContaining({ id: 'column-select', inputType: 'text', options: ['合作', '競爭'] })]),
      })]),
    }), expect.objectContaining({ history: expect.any(Object) })));

    await user.click(screen.getByRole('button', { name: '類型' }));
    await user.selectOptions(screen.getByRole('combobox', { name: '輸入類型' }), 'select');
    expect(screen.getByRole('textbox', { name: '固定選項 1' })).toHaveValue('合作');
    expect(screen.getByRole('textbox', { name: '固定選項 2' })).toHaveValue('競爭');
  });

it('configures and renders fixed option colors', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '類型' }));
    const colorGroup = screen.getByRole('group', { name: '固定選項 1 顏色' });
    await user.click(within(colorGroup).getByRole('button', { name: '固定選項 1 顏色' }));
    await user.click(screen.getByRole('menuitem', { name: '綠色' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    await waitFor(() => expect(document.querySelector('.workspace-column-dialog-overlay')).toBeNull());

    const cell = screen.getByRole('cell', { name: '花火，類型：合作' });
    expect(cell.querySelector('.workspace-cell-value')).toHaveStyle({ color: '#2F6F5E' });

    await user.click(cell);
    expect(screen.getByRole('option', { name: '合作' }).querySelector('.workspace-selection-option-label')).toHaveStyle({ color: '#2F6F5E' });
  });

it('configures inclusive open-ended numeric color ranges', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '數量' }));
    await user.click(screen.getByRole('button', { name: /^數字範圍顏色/ }));
    await user.click(screen.getByRole('button', { name: '新增範圍' }));
    await user.type(screen.getByRole('spinbutton', { name: '第 1 段上限' }), '10');
    const colorGroup = screen.getByRole('group', { name: '第 1 段顏色' });
    await user.click(within(colorGroup).getByRole('button', { name: '第 1 段顏色' }));
    await user.click(screen.getByRole('menuitem', { name: '藍色' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    await waitFor(() => expect(document.querySelector('.workspace-column-dialog-overlay')).toBeNull());

    const cell = screen.getByRole('cell', { name: '花火，數量：2' });
    expect(cell.querySelector('.workspace-cell-value')).toHaveStyle({ color: '#1D4ED8' });
  });

it('locks a clearly horizontal mouse drag without opening the dragged cell', async () => {
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，名稱：空白' });
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;

    const dispatchPointer = (target: Element, type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        pointerType: { value: 'mouse' },
      });
      fireEvent(target, event);
    };

    dispatchPointer(cell, 'pointerdown', 200, 120);
    dispatchPointer(viewport, 'pointermove', 110, 80);
    dispatchPointer(viewport, 'pointerup', 110, 80);
    fireEvent.click(cell);

    expect(viewport.scrollLeft).toBe(90);
    expect(viewport.scrollTop).toBe(0);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

it('keeps a slightly moving touch tap available for opening the cell editor', async () => {
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getAllByRole('cell')).toHaveLength(4));
    const cell = screen.getAllByRole('cell')[2];
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const dispatchTouchPointer = (target: Element, type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: 'touch' },
      });
      fireEvent(target, event);
      return event;
    };

    dispatchTouchPointer(cell, 'pointerdown', 120, 180);
    const slightMove = dispatchTouchPointer(viewport, 'pointermove', 123, 182);
    dispatchTouchPointer(viewport, 'pointerup', 123, 182);

    expect(slightMove.defaultPrevented).toBe(false);
    fireEvent.click(cell);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

it('does not capture a mouse pointer until the gesture becomes a drag', async () => {
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getAllByRole('cell')).toHaveLength(4));
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    const capture = vi.fn();
    viewport.setPointerCapture = capture;
    const dispatchMousePointer = (target: Element, type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: 100 });
      Object.defineProperties(event, {
        pointerId: { value: 3 },
        pointerType: { value: 'mouse' },
      });
      fireEvent(target, event);
    };

    dispatchMousePointer(screen.getAllByRole('cell')[0], 'pointerdown', 100);
    expect(capture).not.toHaveBeenCalled();

    dispatchMousePointer(viewport, 'pointermove', 106);
    expect(capture).toHaveBeenCalledWith(3);
  });

it('places destructive actions at the dialog top-left and omits input confirmation buttons', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '編輯物件 花火' }));
    const deleteButton = screen.getByRole('button', { name: '刪除' });
    expect(deleteButton.parentElement).toHaveClass('workspace-dialog-leading-action');
    expect(screen.queryByRole('button', { name: '確定' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();

    await user.click(deleteButton);
    expect(screen.queryByRole('button', { name: '確認刪除' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '確認' })).toBeInTheDocument();
    expect(document.querySelector('.workspace-dialog-leading-action')).not.toBeInTheDocument();
  });

it('keeps baseline fill while zooming text-driven column widths', async () => {
    const previousResizeObserver = globalThis.ResizeObserver;
    const previousClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    class ResizeObserverMock {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: ResizeObserverMock });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList?.contains('workspace-table-viewport') ? 1000 : 0; } });
    const rendered = render(<WorkspacePage />);

    try {
      const table = await screen.findByRole('table');
      await waitFor(() => expect(table).toHaveStyle({ width: '1000px' }));
      const widthsBefore = [...table.querySelectorAll('col')].map((column) => Number.parseFloat((column as HTMLElement).style.width));
      fireEvent.wheel(document.querySelector('.workspace-table-viewport')!, { ctrlKey: true, deltaY: -100 });
      await waitFor(() => expect(table).toHaveStyle({ '--workspace-text-scale': '1.2' }));
      expect(Number.parseFloat((table as HTMLElement).style.width)).toBeGreaterThan(1000);
      const widthsAfter = [...table.querySelectorAll('col')].map((column) => Number.parseFloat((column as HTMLElement).style.width));
      expect(widthsAfter.some((width, index) => width > widthsBefore[index] + 0.01)).toBe(true);
    } finally {
      rendered.unmount();
      Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: previousResizeObserver });
      if (previousClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', previousClientWidth);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

it('changes only table text scale and persists it for the active table', async () => {
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const viewport = document.querySelector('.workspace-table-viewport');
    expect(viewport).not.toBeNull();

    fireEvent.wheel(viewport!, { ctrlKey: true, deltaY: -100 });
    await waitFor(() => expect(screen.getByRole('table')).toHaveStyle({ '--workspace-text-scale': '1.2' }));
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
      tables: expect.arrayContaining([expect.objectContaining({ id: 'table-1', textScale: 1.2 })]),
    }), expect.objectContaining({ history: expect.any(Object) })));

    fireEvent.click(screen.getByRole('button', { name: '放大文字' }));
    await waitFor(() => expect(screen.getByRole('table')).toHaveStyle({ '--workspace-text-scale': '1.3' }));
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
      tables: expect.arrayContaining([expect.objectContaining({ id: 'table-1', textScale: 1.3 })]),
    }), expect.objectContaining({ history: expect.any(Object) })));
  });

it('scales only the table while keeping modal zoom isolated', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const page = document.querySelector('.workspace-page');
    expect(page).not.toBeNull();

    fireEvent.keyDown(page!, { ctrlKey: true, key: '=' });
    expect(screen.getByRole('table')).toHaveStyle({ '--workspace-text-scale': '1.1' });
    expect(page).not.toHaveStyle({ '--workspace-text-scale': '1.1' });

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { ctrlKey: true, key: '=' });
    expect(page).not.toHaveStyle({ '--workspace-text-scale': '1.1' });
    expect(document.querySelector('.workspace-value-dialog-overlay')).toBeInTheDocument();
  });

it('keeps setting dialogs inside the mobile visual viewport when the keyboard changes it', async () => {
    const previousVisualViewport = window.visualViewport;
    const visualViewport = Object.assign(new EventTarget(), { offsetTop: 12, offsetLeft: 0, width: 390, height: 420 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    const user = userEvent.setup();
    const rendered = render(<WorkspacePage />);

    try {
      await user.click(await screen.findByRole('button', { name: '名稱' }));
      const overlay = document.querySelector('.workspace-column-dialog-overlay');
      expect(overlay).toHaveStyle({ top: '12px', left: '0px', width: '390px', height: '420px' });

      visualViewport.offsetTop = 18;
      visualViewport.height = 300;
      visualViewport.dispatchEvent(new Event('resize'));
      await waitFor(() => expect(overlay).toHaveStyle({ top: '18px', height: '300px' }));
    } finally {
      rendered.unmount();
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
    }
  });

it('shrinks the workspace to the visual viewport while a cell is being edited', async () => {
    const previousVisualViewport = window.visualViewport;
    const visualViewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, width: 390, height: 420 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    const user = userEvent.setup();
    const rendered = render(<WorkspacePage />);
    const page = document.querySelector('.workspace-page');

    try {
      const cell = await waitFor(() => {
        const nextCell = document.querySelector<HTMLElement>('td[data-cell-id]');
        if (!nextCell) throw new Error('The workspace cell did not render');
        return nextCell;
      });
      await user.click(cell);
      await waitFor(() => expect(page).toHaveStyle({ height: '420px', minHeight: '420px', maxHeight: '420px' }));

      visualViewport.height = 300;
      visualViewport.dispatchEvent(new Event('resize'));
      await waitFor(() => expect(page).toHaveStyle({ height: '300px', minHeight: '300px', maxHeight: '300px' }));

      await user.keyboard('{Escape}');
      await waitFor(() => expect(page).not.toHaveStyle({ height: '300px' }));
    } finally {
      rendered.unmount();
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
    }
  });
});
