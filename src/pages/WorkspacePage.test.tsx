import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveWorkspace } from '../workspace/db';
import { WorkspacePage } from './WorkspacePage';

vi.mock('../workspace/db', () => ({
  loadWorkspace: async () => ({
    version: 1,
    activeNodeId: 'node-table',
    nodes: [{ id: 'node-table', type: 'table', name: '測試表格', parentId: null, order: 0, tableId: 'table-1' }],
    tables: [{
      id: 'table-1', name: '測試表格', rowHeaderName: '項目', updatedAt: 0,
      columns: [
        { id: 'column-text', name: '名稱', inputType: 'text', options: [] },
        { id: 'column-number', name: '數量', inputType: 'number', options: [] },
        { id: 'column-select', name: '類型', inputType: 'select', options: ['合作', '競爭'] },
        { id: 'column-dynamic', name: '標籤', inputType: 'dynamic-select', options: [] },
      ],
      rows: [{ id: 'row-1', name: '花火', values: { 'column-text': null, 'column-number': 2, 'column-select': '合作', 'column-dynamic': null } }],
    }],
  }),
  saveWorkspace: vi.fn(async () => undefined),
  flushWorkspaceSaves: vi.fn(async () => undefined),
}));

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(saveWorkspace).mockClear();
});

afterEach(() => cleanup());

describe('WorkspacePage', () => {
  it('uses native text and number controls when cells enter edit mode', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '動態表格' })).toBeInTheDocument());

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('textbox')).toHaveAttribute('inputmode', 'text');

    await user.keyboard('{Escape}');
    await user.click(screen.getByText('2'));
    expect(screen.getByRole('spinbutton')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByRole('spinbutton')).toHaveAttribute('enterkeyhint', 'done');
  });

  it('opens the fixed selection list immediately and saves a choice', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByText('合作')).toBeInTheDocument());

    await user.click(screen.getAllByText('合作')[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '競爭' })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: '競爭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('競爭')).toBeInTheDocument();
  });

  it('preserves line breaks in fixed list options', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '名稱' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '固定列表' }));
    const option = screen.getByRole('textbox', { name: '固定選項 1' });
    await user.type(option, '第一行');
    await user.keyboard('{Enter}');
    await user.type(option, '第二行');
    await user.click(screen.getByRole('button', { name: '新增選項' }));
    await user.type(screen.getByRole('textbox', { name: '固定選項 2' }), '單行');
    await user.click(screen.getByRole('button', { name: '向上移動固定選項 2' }));
    fireEvent.pointerDown(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual(['單行', '第一行\n第二行']);
  });

  it('opens the dynamic selection search and commits a new value from text submission', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，標籤：空白' })).toBeInTheDocument());

    await user.click(screen.getByRole('cell', { name: '花火，標籤：空白' }));
    const search = screen.getByRole('textbox', { name: '搜尋或新增選項' });
    expect(search).toHaveAttribute('enterkeyhint', 'done');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.type(search, '新標籤');
    fireEvent.pointerDown(document.querySelector('.workspace-selection-dialog-overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('新標籤')).toBeInTheDocument();
  });

  it('reuses an existing dynamic option instead of creating a case variant', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getAllByRole('cell')).toHaveLength(4));

    await user.click(screen.getAllByRole('cell')[3]);
    const search = screen.getAllByRole('textbox')[0];
    await user.type(search, 'Tag');
    await user.keyboard('{Enter}');

    await user.click(screen.getByText('Tag'));
    const secondSearch = screen.getAllByRole('textbox')[0];
    await user.type(secondSearch, 'tag');
    await user.keyboard('{Enter}');

    expect(screen.getByText('Tag')).toBeInTheDocument();
    expect(screen.queryByText('tag')).not.toBeInTheDocument();
  });

  it('keeps item names and the item axis separate from attribute columns', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '編輯項目 花火' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '編輯項目 花火' }));
    const itemName = screen.getByRole('textbox', { name: '項目名稱' });
    await user.clear(itemName);
    await user.type(itemName, '收藏清單第一項');
    fireEvent.pointerDown(document.querySelector('.workspace-cell-name-dialog-overlay')!);
    expect(screen.getByRole('button', { name: '編輯項目 收藏清單第一項' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '項目' }));
    const axisName = screen.getByRole('textbox', { name: '項目軸名稱' });
    await user.clear(axisName);
    await user.type(axisName, '桌遊收藏');
    fireEvent.pointerDown(document.querySelector('.workspace-cell-name-dialog-overlay')!);
    expect(screen.getByRole('button', { name: '桌遊收藏' })).toBeInTheDocument();
  });

  it('allows intentional line breaks in item and column headers', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '編輯項目 花火' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '編輯項目 花火' }));
    await user.clear(screen.getByRole('textbox', { name: '項目名稱' }));
    await user.type(screen.getByRole('textbox', { name: '項目名稱' }), '收藏{Enter}第一項');
    fireEvent.pointerDown(document.querySelector('.workspace-cell-name-dialog-overlay')!);
    expect(screen.getByRole('button', { name: /編輯項目 收藏\s+第一項/ }).textContent).toBe('收藏\n第一項');

    await user.click(screen.getByRole('button', { name: '名稱' }));
    const columnName = screen.getByRole('textbox', { name: '欄位名稱' });
    await user.clear(columnName);
    await user.type(columnName, '桌遊{Enter}名稱');
    fireEvent.pointerDown(document.querySelector('.workspace-column-dialog-overlay')!);
    expect(screen.getByRole('button', { name: /桌遊\s+名稱/ }).textContent).toBe('桌遊\n名稱');
  });

  it('preserves fixed options while trying other input types', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '類型' }));
    expect(screen.getByRole('textbox', { name: '固定選項 1' })).toHaveValue('合作');
    expect(screen.getByRole('textbox', { name: '固定選項 2' })).toHaveValue('競爭');

    await user.click(screen.getByRole('button', { name: '文字' }));
    fireEvent.pointerDown(document.querySelector('.workspace-column-dialog-overlay')!);
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
      tables: expect.arrayContaining([expect.objectContaining({
        columns: expect.arrayContaining([expect.objectContaining({ id: 'column-select', inputType: 'text', options: ['合作', '競爭'] })]),
      })]),
    })));

    await user.click(screen.getByRole('button', { name: '類型' }));
    await user.click(screen.getByRole('button', { name: '固定列表' }));
    expect(screen.getByRole('textbox', { name: '固定選項 1' })).toHaveValue('合作');
    expect(screen.getByRole('textbox', { name: '固定選項 2' })).toHaveValue('競爭');
  });

  it('pans the table with a mouse drag without opening the dragged cell', async () => {
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
    expect(viewport.scrollTop).toBe(40);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('places destructive actions at the dialog top-left and omits input confirmation buttons', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '編輯項目 花火' }));
    const deleteButton = screen.getByRole('button', { name: '刪除' });
    expect(deleteButton.parentElement).toHaveClass('workspace-dialog-leading-action');
    expect(screen.queryByRole('button', { name: '確定' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();

    await user.click(deleteButton);
    const confirmedDelete = screen.getByRole('button', { name: '刪除' });
    expect(confirmedDelete.parentElement).toHaveClass('workspace-dialog-leading-action');
  });

  it('fills the viewport proportionally while zooming through text size', async () => {
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
      await waitFor(() => expect(table).toHaveStyle({ '--workspace-text-scale': '1.2', width: '1000px' }));
      const widthsAfter = [...table.querySelectorAll('col')].map((column) => Number.parseFloat((column as HTMLElement).style.width));
      widthsAfter.forEach((width, index) => expect(width).toBeCloseTo(widthsBefore[index], 8));
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
    })));

    fireEvent.click(screen.getByRole('button', { name: '放大文字' }));
    await waitFor(() => expect(screen.getByRole('table')).toHaveStyle({ '--workspace-text-scale': '1.3' }));
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
      tables: expect.arrayContaining([expect.objectContaining({ id: 'table-1', textScale: 1.3 })]),
    })));
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

  it('shows the table name and only add-property and settings actions in the app bar', async () => {
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByText('測試表格')).toBeInTheDocument());
    const appBar = document.querySelector('.workspace-appbar')!;
    expect([...appBar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['開啟目錄', '新增屬性', '設定']);
  });
});
