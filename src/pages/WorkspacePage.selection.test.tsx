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
describe('WorkspacePage.selection', () => {
it('opens the fixed selection list immediately and saves a choice', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByText('合作')).toBeInTheDocument());

    await user.click(screen.getAllByText('合作')[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '競爭' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '競爭' }).querySelector('.workspace-selection-option-indicator')).toBeNull();

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
    await user.click(screen.getByRole('button', { name: '清除' }));
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
    await user.selectOptions(screen.getByRole('combobox', { name: '輸入類型' }), 'select');
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
    expect(screen.getByText('拖曳中：第 2 個選項')).toBeInTheDocument();
    expect(dragHandle).toHaveAttribute('aria-grabbed', 'true');
    expect(document.activeElement).not.toBe(option);
    expect(document.querySelector('.workspace-option-drop-indicator')).toBeInTheDocument();
    dispatchPointer(window, 'pointermove', -20);
    dispatchPointer(window, 'pointerup', -20);
    expect(screen.queryByText('拖曳中：第 2 個選項')).not.toBeInTheDocument();
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

it('ranks dynamic options by usage after editing and undo/redo', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('cell', { name: '花火，標籤：空白' }));
    fireEvent.click(document.querySelector('.workspace-selection-dialog-overlay')!);
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));

    await user.click(screen.getByRole('cell', { name: '花火，標籤：空白' }));
    await user.type(screen.getByRole('textbox', { name: '搜尋或新增選項' }), '少用');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('cell', { name: '物件 2，標籤：空白' }));
    await user.type(screen.getByRole('textbox', { name: '搜尋或新增選項' }), '常用');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('cell', { name: '物件 3，標籤：空白' }));
    await user.click(screen.getByRole('option', { name: '常用' }));

    await user.click(screen.getByRole('cell', { name: '花火，標籤：少用' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['常用', '少用']);
    await user.click(screen.getByRole('option', { name: '常用' }));
    await user.click(screen.getByRole('cell', { name: '花火，標籤：常用' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['常用']);
    fireEvent.click(document.querySelector('.workspace-selection-dialog-overlay')!);

    await user.click(screen.getByRole('button', { name: '復原' }));
    await user.click(screen.getByRole('cell', { name: '花火，標籤：少用' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['常用', '少用']);
    fireEvent.click(document.querySelector('.workspace-selection-dialog-overlay')!);
    await user.click(screen.getByRole('button', { name: '重做' }));
    await user.click(screen.getByRole('cell', { name: '花火，標籤：常用' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['常用']);
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

it('uses the same compact dynamic-list surface for immediate multi-selection', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('columnheader', { name: '標籤' })).toBeInTheDocument());

    await user.click(screen.getByRole('columnheader', { name: '標籤' }));
    await user.click(screen.getByRole('checkbox', { name: '多選' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    const cell = screen.getByRole('cell', { name: '花火，標籤：空白' });
    await user.click(cell);
    const search = screen.getByRole('textbox', { name: '搜尋或新增選項' });
    expect(screen.queryByRole('button', { name: /確定/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全選' })).toBeInTheDocument();
    expect(screen.getByRole('listbox').nextElementSibling).toHaveClass('workspace-selection-footer');

    await user.type(search, '第一項');
    await user.keyboard('{Enter}');
    await user.type(search, '第二項');
    await user.keyboard('{Enter}');

    expect(screen.getByRole('option', { name: '第一項' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: '第二項' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(document.querySelector('.workspace-selection-dialog-overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cell).toHaveTextContent('第一項');
    expect(cell).toHaveTextContent('第二項');
  });
});
