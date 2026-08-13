import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveWorkspace } from '../workspace/db';
import { WorkspacePage } from './WorkspacePage';

vi.mock('../workspace/db', () => ({
  loadWorkspace: async () => ({
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
  }),
  saveWorkspace: vi.fn(async () => undefined),
  loadWorkspaceHistories: vi.fn(async () => new Map()),
  saveWorkspaceHistory: vi.fn(async () => undefined),
  clearAllWorkspaceHistories: vi.fn(async () => undefined),
  deleteWorkspaceHistories: vi.fn(async () => undefined),
  flushWorkspaceSaves: vi.fn(async () => undefined),
}));

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(saveWorkspace).mockClear();
});

afterEach(() => cleanup());

describe('WorkspacePage', () => {
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

  it('selects same-property cells by long press and commits one shared value', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));

    const first = screen.getByRole('cell', { name: '花火，名稱：空白' });
    const second = screen.getByRole('cell', { name: '物件 2，名稱：空白' });
    await longPress(first);
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');
    expect(screen.getByRole('status')).toHaveTextContent('只能選取同一屬性');
    await user.click(second);
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 2 格');

    await user.click(screen.getByRole('button', { name: '設定 名稱 的批次內容' }));
    await user.type(screen.getByRole('textbox', { name: '名稱批次輸入' }), '共同內容');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    await user.click(screen.getByRole('button', { name: '輸入至已選方格' }));

    expect(screen.getAllByText('共同內容')).toHaveLength(2);
    expect(screen.queryByRole('toolbar', { name: '批次編輯 名稱' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '復原' }));
    expect(screen.queryByText('共同內容')).not.toBeInTheDocument();
  });

  it('accepts the first real cell tap after a long press that produces no synthetic click', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));

    const first = screen.getByRole('cell', { name: '花火，名稱：空白' });
    const second = screen.getByRole('cell', { name: '物件 2，名稱：空白' });
    await longPressWithoutSyntheticClick(first);
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');

    await user.click(second);
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 2 格');
  });

  it('previews proportional number allocation before the toolbar confirmation', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    const first = screen.getByRole('cell', { name: '花火，數量：2' });
    const second = screen.getByRole('cell', { name: '物件 2，數量：空白' });
    await longPress(first);
    await user.click(second);
    await user.click(screen.getByRole('button', { name: '設定 數量 的批次內容' }));
    await user.clear(screen.getByRole('spinbutton', { name: '數量批次輸入' }));
    await user.type(screen.getByRole('spinbutton', { name: '數量批次輸入' }), '10');
    await user.click(screen.getByRole('button', { name: '比例分配' }));
    await user.clear(screen.getByRole('spinbutton', { name: '物件 2比例' }));
    await user.type(screen.getByRole('spinbutton', { name: '物件 2比例' }), '3');
    expect(screen.getByRole('status', { name: '花火分配結果' })).toHaveTextContent('3');
    expect(screen.getByRole('status', { name: '物件 2分配結果' })).toHaveTextContent('7');
    expect(screen.queryByRole('button', { name: '套用預覽' })).not.toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(first).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: '輸入至已選方格' }));
    expect(screen.getByRole('cell', { name: '花火，數量：3' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '物件 2，數量：7' })).toBeInTheDocument();
  });

  it('embeds collapsed proportional allocation below the batch number input', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await longPress(screen.getByRole('cell', { name: '花火，數量：2' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));

    expect(screen.queryByRole('button', { name: '比例分配' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '設定 數量 的批次內容' }));
    const dialog = screen.getByRole('dialog');
    const disclosure = within(dialog).getByRole('button', { name: '比例分配' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByRole('spinbutton', { name: '花火比例' })).not.toBeInTheDocument();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('spinbutton', { name: '花火比例' })).toBeInTheDocument();
    expect(within(dialog).getByText('近似取整')).toBeInTheDocument();
    expect(within(dialog).queryByText('結果')).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('→').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('keeps the shared number input and proportional total synchronized', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await longPress(screen.getByRole('cell', { name: '花火，數量：2' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));

    await user.click(screen.getByRole('button', { name: '設定 數量 的批次內容' }));
    const sharedInput = screen.getByRole('spinbutton', { name: '數量批次輸入' });
    await user.clear(sharedInput);
    await user.type(sharedInput, '12');
    await user.click(screen.getByRole('button', { name: '比例分配' }));
    expect(sharedInput).toHaveValue(12);
    await user.clear(sharedInput);
    await user.type(sharedInput, '20');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    await user.click(screen.getByRole('button', { name: '設定 數量 的批次內容' }));
    expect(screen.getByRole('spinbutton', { name: '數量批次輸入' })).toHaveValue(20);
  });

  it('invalidates a staged ratio instead of clearing cells when the selection changes', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    const first = screen.getByRole('cell', { name: '花火，數量：2' });
    const second = screen.getByRole('cell', { name: '物件 2，數量：空白' });
    await longPress(first);
    await user.click(second);
    await user.click(screen.getByRole('button', { name: '設定 數量 的批次內容' }));
    await user.clear(screen.getByRole('spinbutton', { name: '數量批次輸入' }));
    await user.type(screen.getByRole('spinbutton', { name: '數量批次輸入' }), '10');
    await user.click(screen.getByRole('button', { name: '比例分配' }));
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.getByRole('button', { name: '輸入至已選方格' })).toBeEnabled();

    await user.click(second);
    expect(screen.getByRole('button', { name: '輸入至已選方格' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('請重新設定比例');
    expect(first).toHaveTextContent('2');
  });

  it('uses native text and number controls when cells enter edit mode', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '動態表格' })).toBeInTheDocument());

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('textbox').closest('[role="dialog"]')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('inputmode', 'text');

    await user.keyboard('{Escape}');
    await user.click(screen.getByText('2'));
    expect(screen.getByRole('spinbutton').closest('[role="dialog"]')).toBeInTheDocument();
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

  it('clears a fixed-list value without opening another editor', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getAllByRole('cell')).toHaveLength(4));
    const fixedListCell = screen.getAllByRole('cell')[2];
    await user.click(fixedListCell);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(document.querySelector('.workspace-selection-clear-row button')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fixedListCell).toHaveTextContent('');
  });

  it('commits a text dialog by clicking beside it without changing table widths', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getAllByRole('cell')).toHaveLength(4));
    const widthsBefore = [...document.querySelectorAll('.workspace-table col')].map((column) => column.getAttribute('style'));

    await user.click(screen.getAllByRole('cell')[0]);
    const input = screen.getByRole('textbox');
    await user.type(input, 'new value');
    expect(input.closest('[role="dialog"]')).toBeInTheDocument();
    expect([...document.querySelectorAll('.workspace-table col')].map((column) => column.getAttribute('style'))).toEqual(widthsBefore);

    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('new value')).toBeInTheDocument();
  });

  it('does not reopen a cell when the outside click finishes the editor', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，名稱：空白' });

    await user.click(cell);
    const overlay = document.querySelector('.workspace-value-dialog-overlay')!;
    await user.click(overlay);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cell).not.toHaveClass('is-editing');
  });

  it('preserves line breaks in fixed list options', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '名稱' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '選單' }));
    await user.click(screen.getByRole('button', { name: '固定列表' }));
    const option = screen.getByRole('textbox', { name: '固定選項 1' });
    await user.type(option, '第一行');
    await user.keyboard('{Enter}');
    await user.type(option, '第二行');
    await user.click(screen.getByRole('button', { name: '新增選項' }));
    await user.type(screen.getByRole('textbox', { name: '固定選項 2' }), '單行');
    const dragHandle = screen.getByRole('button', { name: '拖曳固定選項 2' });
    const dispatchPointer = (target: Element | Window, type: string, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
      fireEvent(target, event);
    };
    dispatchPointer(dragHandle, 'pointerdown', 100);
    dispatchPointer(window, 'pointermove', -20);
    dispatchPointer(window, 'pointerup', -20);
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

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
    fireEvent.click(document.querySelector('.workspace-selection-dialog-overlay')!);
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
    expect(screen.getAllByRole('button', { name: /桌遊\s+名稱/ }).find((button) => button.classList.contains('workspace-column-name'))?.textContent).toBe('桌遊\n名稱');
  });

  it('preserves fixed options while trying other input types', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '類型' }));
    expect(screen.getByRole('textbox', { name: '固定選項 1' })).toHaveValue('合作');
    expect(screen.getByRole('textbox', { name: '固定選項 2' })).toHaveValue('競爭');

    await user.click(screen.getByRole('button', { name: '文字' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
      tables: expect.arrayContaining([expect.objectContaining({
        columns: expect.arrayContaining([expect.objectContaining({ id: 'column-select', inputType: 'text', options: ['合作', '競爭'] })]),
      })]),
    })));

    await user.click(screen.getByRole('button', { name: '類型' }));
    await user.click(screen.getByRole('button', { name: '選單' }));
    await user.click(screen.getByRole('button', { name: '固定列表' }));
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

    const cell = screen.getByRole('cell', { name: '花火，類型：合作' });
    expect(cell.querySelector('.workspace-cell-value')).toHaveStyle({ color: '#2F6F5E' });

    await user.click(cell);
    expect(screen.getByRole('option', { name: '合作' }).querySelector('span')).toHaveStyle({ color: '#2F6F5E' });
  });

  it('configures inclusive open-ended numeric color ranges', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '數量' }));
    await user.click(screen.getByRole('button', { name: '新增範圍' }));
    await user.type(screen.getByRole('spinbutton', { name: '第 1 段上限' }), '10');
    const colorGroup = screen.getByRole('group', { name: '第 1 段顏色' });
    await user.click(within(colorGroup).getByRole('button', { name: '第 1 段顏色' }));
    await user.click(screen.getByRole('menuitem', { name: '藍色' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

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
    const confirmedDelete = screen.getByRole('button', { name: '確認刪除' });
    expect(confirmedDelete.parentElement).toHaveClass('workspace-dialog-leading-action');
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
    })));

    fireEvent.click(screen.getByRole('button', { name: '放大文字' }));
    await waitFor(() => expect(screen.getByRole('table')).toHaveStyle({ '--workspace-text-scale': '1.3' }));
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalledWith(expect.objectContaining({
      tables: expect.arrayContaining([expect.objectContaining({ id: 'table-1', textScale: 1.3 })]),
    })));
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
    expect(screen.getByRole('status')).toHaveTextContent('已新增屬性');
    expect(screen.getByRole('columnheader', { name: /屬性 5/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新增物件' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已新增物件');
    expect(screen.getByRole('row', { name: /物件 2/ })).toBeInTheDocument();
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
      })));
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

  it('edits the first column through the same property settings as other columns', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '物件' }));

    expect(screen.getByRole('button', { name: '選單' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '其他' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '其他' }));
    expect(screen.getByRole('button', { name: '連結' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '時間(含日期)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除屬性' })).not.toBeInTheDocument();
  });

  it('opens display settings from one left-side button into the right panel', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));

    const rail = document.querySelector('.workspace-column-config-rail');
    const panel = document.querySelector('.workspace-column-config-panel');
    expect(rail?.querySelector('.workspace-alignment-field')).toBeInTheDocument();
    expect(rail?.querySelector('.workspace-overflow-field')).toBeInTheDocument();
    expect(panel?.querySelector('.workspace-input-subtype-options')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '自動換行' }));
    expect(panel?.querySelector('.workspace-overflow-panel')).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByRole('button', { name: '推擠寬度' })).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByRole('button', { name: '超過省略' })).toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(await screen.findByRole('columnheader', { name: '類型' }));
    expect(document.querySelector('.workspace-column-config-panel .workspace-option-list')).toBeInTheDocument();
  });

  it('edits and renders a link with a preferred display name and external action', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '連結' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '連結' }), 'example.com/game');
    await user.type(screen.getByRole('textbox', { name: '顯示名稱' }), '遊戲頁面');
    fireEvent.click(document.querySelector('.workspace-link-dialog-overlay')!);

    expect(screen.getByText('遊戲頁面')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '外連' })).toHaveAttribute('href', 'https://example.com/game');
    expect(screen.getByRole('link', { name: '外連' })).not.toHaveTextContent('外連');
  });

  it('immediately renders an external action when ordinary cell text is a URL', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), 'example.com/game');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    expect(screen.getByRole('link', { name: '外連' })).toHaveAttribute('href', 'https://example.com/game');
  });

  it('suggests current distinct values when changing a property to a fixed list', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), '合作');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    await user.click(screen.getByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '選單' }));
    await user.click(screen.getByRole('button', { name: '固定列表' }));

    expect(screen.getByRole('textbox', { name: '固定選項 1' })).toHaveValue('合作');
  });

  it('opens the compact date-time wheel editor and displays zero-padded values', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('group', { name: '名稱日期時間' })).toBeInTheDocument();
    const minuteWheel = screen.getByRole('listbox', { name: '分' });
    const currentMinute = within(minuteWheel).getByRole('option', { selected: true }).textContent;
    fireEvent.wheel(minuteWheel, { deltaY: -30 });
    expect(within(minuteWheel).getByRole('option', { selected: true })).not.toHaveTextContent(currentMinute ?? '');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    expect(screen.getByText(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('can display only the date without discarding the stored time', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    await user.click(screen.getByRole('checkbox', { name: '只顯示年月日' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('group', { name: '名稱日期' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: '時' })).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: '分' })).not.toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    expect(screen.getByText(/^\d{4}\/\d{2}\/\d{2}$/)).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalled());
    const latest = vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0];
    const column = latest?.tables[0].columns[0];
    expect(column?.dateOnly).toBe(true);
    expect(latest?.tables[0].rows[0].values[column!.id]).toMatch(/T/);
  });

  it('clears an existing date-time value from the compact editor', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(document.querySelector('.workspace-datetime-timezone')).toBeInTheDocument();
    await user.click(document.querySelector('.workspace-datetime-clear')!);
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument();
  });

  it('sets an ellipsis width limit in full-width characters', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));

    await user.click(screen.getByRole('button', { name: '自動換行' }));
    await user.click(screen.getByRole('button', { name: '超過省略' }));
    await user.type(screen.getByRole('spinbutton', { name: '欄寬上限（全形字數）' }), '6');
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalled());
    const latest = vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0];
    expect(latest?.tables[0].columns[0]).toMatchObject({ overflowMode: 'ellipsis', widthLimitChars: 6 });
  });

  it('keeps database import in the drawer instead of the current-table settings', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '設定' }));
    expect(screen.queryByRole('button', { name: '匯入整個資料庫' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '設定' }));
    await user.click(screen.getByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    expect(within(drawer).getByRole('button', { name: '匯入整個資料庫' })).toBeInTheDocument();
  });

  it('hides selected columns and edits them from the object arrow panel', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '設定' }));
    await user.click(screen.getByRole('button', { name: '欄位顯示設定' }));

    expect(screen.getByRole('dialog', { name: '欄位顯示設定' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '隱藏 類型' }));
    expect(screen.getByRole('button', { name: '顯示 類型' })).toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-column-visibility-dialog-overlay')!);

    expect(screen.queryByRole('columnheader', { name: '類型' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: '花火，類型：合作' })).not.toBeInTheDocument();
    const arrow = screen.getByRole('button', { name: '編輯 花火 的隱藏欄位' });
    await user.click(arrow);
    const hiddenDialog = screen.getByRole('dialog', { name: '花火' });
    expect(within(hiddenDialog).getByText('類型')).toBeInTheDocument();
    await user.click(within(hiddenDialog).getByRole('button', { name: '競爭' }));
    fireEvent.click(document.querySelector('.workspace-hidden-fields-dialog-overlay')!);

    const latestSave = vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0];
    expect(latestSave?.tables[0].rows[0].values['column-select']).toBe('競爭');
    expect(screen.queryByRole('cell', { name: '花火，類型：競爭' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '欄位顯示設定' }));
    await user.click(screen.getByRole('button', { name: '顯示 類型' }));
    fireEvent.click(document.querySelector('.workspace-column-visibility-dialog-overlay')!);
    expect(screen.getByRole('cell', { name: '花火，類型：競爭' })).toBeInTheDocument();
  });

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
    expect(screen.getByText('顯示 0 / 1 項')).toBeInTheDocument();
    expect([...document.querySelectorAll('.workspace-appbar-actions button')].map((btn) => btn.getAttribute('aria-label'))).toEqual(['搜尋', '編輯', '設定']);
  });

  it('filters, sorts, and searches values from every first-row header', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));
    await user.type(screen.getByRole('spinbutton'), '10');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

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
  });

  it('searches text filter values without option checkboxes', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
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
      })));
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
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    viewport.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 400, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) });
    document.elementFromPoint = vi.fn(() => target);
    window.requestAnimationFrame = vi.fn((callback) => { animationFrame = callback; return 1; });
    window.cancelAnimationFrame = vi.fn();

    try {
      dispatchPointer(source, 'pointerdown', 100, 40);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      dispatchPointer(viewport, 'pointermove', 395, 150);
      animationFrame?.(0);
      expect(viewport.scrollLeft).toBeGreaterThan(0);
    } finally {
      dispatchPointer(viewport, 'pointerup', 395, 150);
      document.elementFromPoint = previousElementFromPoint;
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;
    }
  });
});
