import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('WorkspacePage', () => {
it('persists column statistics immediately when dynamic-list settings are saved', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), '常用');
    await user.click(screen.getByRole('button', { name: '關閉' }));
    vi.mocked(saveWorkspace).mockClear();

    await user.click(screen.getByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '選單' }));
    await user.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(saveWorkspace).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(saveWorkspace).mock.calls[0][0].tables[0];
    expect(saved.columns[0]).toMatchObject({ inputType: 'dynamic-select', dynamicOptions: {
      version: 1, sourceRevision: saved.changeRevision, counts: [{ key: '常用', count: 1, spellings: [['常用', 1]] }],
    } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

it.each(['close-button', 'backdrop', 'escape'] as const)('saves a cell draft on %s exactly once', async (reason) => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), '已儲存');
    if (reason === 'close-button') await user.click(screen.getByRole('button', { name: '關閉' }));
    else if (reason === 'escape') await user.keyboard('{Escape}');
    else fireEvent.click(screen.getByRole('dialog').parentElement!);

    expect(screen.getByRole('cell', { name: '花火，名稱：已儲存' })).toBeInTheDocument();
    expect(saveWorkspace).toHaveBeenCalledTimes(1);
    expect(saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({
      tables: [expect.objectContaining({ rows: [expect.objectContaining({ values: expect.objectContaining({ 'column-text': '已儲存' }) })] })],
    }), expect.objectContaining({
      mutation: expect.objectContaining({ tableId: 'table-1', action: expect.objectContaining({ type: 'set-cell', rowId: 'row-1', columnId: 'column-text', after: '已儲存' }) }),
      history: expect.objectContaining({ append: expect.any(Array) }),
    }));
  });

it.each(['close-button', 'browser-back'] as const)('preserves the table name draft policy for %s', async (reason) => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '重新命名表格' }));
    const input = screen.getByRole('textbox', { name: '名稱' });
    await user.clear(input);
    await user.type(input, '新的名稱');
    if (reason === 'browser-back') fireEvent(window, new PopStateEvent('popstate'));
    else await user.click(screen.getByRole('button', { name: '關閉' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent(reason === 'browser-back' ? '測試表格' : '新的名稱');
    expect(saveWorkspace).toHaveBeenCalledTimes(reason === 'browser-back' ? 0 : 1);
    await user.click(screen.getByRole('button', { name: '重新命名表格' }));
    expect(screen.getByRole('textbox', { name: '名稱' })).toHaveValue(reason === 'browser-back' ? '測試表格' : '新的名稱');
  });

it.each(['close-button', 'browser-back'] as const)('preserves the column draft policy and isolates the next target for %s', async (reason) => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    const input = screen.getByRole('textbox', { name: '屬性名稱' });
    await user.clear(input);
    await user.type(input, '新屬性');
    if (reason === 'browser-back') fireEvent(window, new PopStateEvent('popstate'));
    else await user.click(screen.getByRole('button', { name: '關閉' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: reason === 'browser-back' ? '名稱' : '新屬性' })).toBeInTheDocument();
    expect(saveWorkspace).toHaveBeenCalledTimes(reason === 'browser-back' ? 0 : 1);
    await user.click(screen.getByRole('columnheader', { name: '數量' }));
    expect(screen.getByRole('textbox', { name: '屬性名稱' })).toHaveValue('數量');
  });

it('does not save a type conversion when the column settings draft is cancelled by browser back', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '數量' }));
    await user.click(screen.getByRole('button', { name: '選單' }));
    await user.click(screen.getByRole('button', { name: '動態列表' }));
    expect(saveWorkspace).not.toHaveBeenCalled();
    expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument();

    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveWorkspace).not.toHaveBeenCalled();

    await user.click(screen.getByRole('columnheader', { name: '數量' }));
    expect(screen.getByRole('button', { name: '數字' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument();
  });

it('keeps an invalid conversion open without saving, then retries after choosing a valid type', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), '不是數字');
    await user.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(saveWorkspace).toHaveBeenCalledTimes(1));
    vi.mocked(saveWorkspace).mockClear();

    await user.click(screen.getByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '數字' }));
    await user.click(screen.getByRole('button', { name: '關閉' }));

    expect(screen.getByRole('dialog', { name: '屬性設定' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('無法轉換成數字');
    expect(saveWorkspace).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '選單' }));
    await user.click(screen.getByRole('button', { name: '動態列表' }));
    await user.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(saveWorkspace).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveWorkspace).mock.calls[0][0].tables[0];
    expect(saved.columns.find(column => column.id === 'column-text')?.inputType).toBe('dynamic-select');
    expect(saved).toMatchObject({
      rows: [expect.objectContaining({ values: expect.objectContaining({ 'column-text': '不是數字' }) })],
    });
  });
});
