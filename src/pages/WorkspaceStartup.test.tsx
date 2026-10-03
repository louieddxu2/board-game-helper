import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './WorkspacePage';
import { loadWorkspace, loadWorkspaceInitial } from '../workspace/db';
import type { WorkspaceTableHistory, WorkspaceTableHistoryEntry } from '../workspace/history';

const db = vi.hoisted(() => ({
  loadWorkspaceHistories: vi.fn(), saveWorkspace: vi.fn(async (_data: unknown, _options?: unknown) => undefined),
}));
vi.mock('../workspace/backgroundWork', () => ({ afterWorkspacePaint: (work: () => void) => { work(); return () => undefined; } }));
vi.mock('../workspace/db', () => {
  const loadWorkspace = vi.fn(async () => ({
    version: 1, activeNodeId: 'node-1', nodes: [{ id: 'node-1', type: 'table', tableId: 'table-1', name: '本機表格', parentId: null, order: 0 }],
    tables: [{ id: 'table-1', name: '本機表格', rowHeaderName: '項目', updatedAt: 1,
      columns: [{ id: 'column-1', name: '名稱', inputType: 'text', options: [] }],
      rows: [{ id: 'row-1', name: '物件', values: { 'column-1': '原值' } }],
    }],
  }));
  const loadWorkspaceInitial = vi.fn(async () => ({ data: await loadWorkspace(), complete: true }));
  return {
  ...db,
  loadWorkspace,
  loadWorkspaceInitial,
  assertWorkspaceStorageCurrent: vi.fn(async () => undefined),
};
});

let resolveHistory: (history: Map<string, WorkspaceTableHistory>) => void;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  db.loadWorkspaceHistories.mockImplementation(() => new Promise((resolve) => { resolveHistory = resolve; }));
});
afterEach(cleanup);

const editBeforeHistoryLoads = async () => {
  fireEvent.click(await screen.findByRole('cell', { name: '物件，名稱：原值' }));
  fireEvent.change(screen.getByRole('textbox', { name: '名稱輸入' }), { target: { value: '新值' } });
  fireEvent.click(screen.getByRole('button', { name: '關閉' }));
  expect(screen.getByRole('cell', { name: '物件，名稱：新值' })).toBeInTheDocument();
};

describe('workspace startup', () => {
  it('retains search focus when the directory finishes loading', async () => {
    const base = await loadWorkspace();
    const otherTable = { ...base.tables[0], id: 'table-2', name: '其他表格' };
    const full = { ...base, nodes: [...base.nodes, { ...base.nodes[0], id: 'node-2', tableId: otherTable.id, name: otherTable.name, order: 1 }], tables: [...base.tables, otherTable] };
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: { ...full, tables: base.tables }, complete: false });
    let finishTableLoad!: (value: typeof full) => void;
    vi.mocked(loadWorkspace).mockImplementationOnce(() => new Promise((resolve) => { finishTableLoad = resolve; }));
    render(<WorkspacePage />);
    fireEvent.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const search = screen.getByRole('searchbox', { name: '搜尋表格與資料夾' });
    search.focus();
    fireEvent.change(search, { target: { value: '其他' } });
    await act(async () => finishTableLoad(full));
    const hydratedSearch = screen.getByRole('searchbox', { name: '搜尋表格與資料夾' });
    expect(hydratedSearch).toHaveValue('其他');
    expect(document.activeElement).toBe(hydratedSearch);
  });

  it('opens the directory before remaining tables load and switches to a queued table after hydration', async () => {
    const base = await loadWorkspace();
    const otherTable = { ...base.tables[0], id: 'table-2', name: '其他表格' };
    const full = {
      ...base,
      nodes: [...base.nodes, { ...base.nodes[0], id: 'node-2', tableId: otherTable.id, name: otherTable.name, order: 1 }],
      tables: [...base.tables, otherTable],
    };
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: { ...full, tables: base.tables }, complete: false });
    let finishTableLoad!: (value: typeof full) => void;
    vi.mocked(loadWorkspace).mockImplementationOnce(() => new Promise((resolve) => { finishTableLoad = resolve; }));

    render(<WorkspacePage />);
    fireEvent.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    expect(within(drawer).getByRole('status')).toHaveTextContent('正在讀取其他表格');
    expect(screen.queryByRole('button', { name: '新增表格' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('其他表格'));
    expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent('本機表格');
    expect(db.saveWorkspace).not.toHaveBeenCalled();

    await act(async () => finishTableLoad(full));
    await waitFor(() => expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent('其他表格'));
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(db.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ activeNodeId: 'node-2' }), expect.objectContaining({
      history: expect.objectContaining({ append: [] }),
    }));
  });

  it('loads a bottom-navigation table before the rest and keeps an early edit when hydration merges', async () => {
    const base = await loadWorkspace();
    const activeTable = { ...base.tables[0], id: 'table-1', name: '本機表格', rows: base.tables[0].rows.map((row) => ({ ...row, id: 'row-active' })) };
    const pinnedTable = { ...base.tables[0], id: 'table-2', name: '置底表格', rows: base.tables[0].rows.map((row) => ({ ...row, id: 'row-pinned' })) };
    const otherTable = { ...base.tables[0], id: 'table-3', name: '背景表格', rows: base.tables[0].rows.map((row) => ({ ...row, id: 'row-background' })) };
    const full = {
      ...base,
      activeNodeId: 'node-1',
      bottomNavigationTableIds: ['table-2'],
      nodes: [
        { ...base.nodes[0], id: 'node-1', tableId: activeTable.id, name: activeTable.name, order: 0 },
        { ...base.nodes[0], id: 'node-2', tableId: pinnedTable.id, name: pinnedTable.name, order: 1 },
        { ...base.nodes[0], id: 'node-3', tableId: otherTable.id, name: otherTable.name, order: 2 },
      ],
      tables: [activeTable, pinnedTable, otherTable],
    };
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: { ...full, tables: [activeTable] }, complete: false });
    let resolvePinned!: (value: typeof full) => void;
    let resolveFull!: (value: typeof full) => void;
    vi.mocked(loadWorkspace)
      .mockImplementationOnce((options?: { tableIds?: readonly string[] }) => {
        expect(options?.tableIds).toEqual(['table-2']);
        return new Promise((resolve) => { resolvePinned = resolve; });
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFull = resolve; }));
    db.loadWorkspaceHistories.mockResolvedValue(new Map());

    const user = userEvent.setup();
    render(<WorkspacePage />);
    expect(await screen.findByRole('cell', { name: '物件，名稱：原值' })).toBeInTheDocument();
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledWith({ expectCurrentRevision: true, tableIds: ['table-2'] }));

    fireEvent.click(screen.getByRole('cell', { name: '物件，名稱：原值' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名稱輸入' }), { target: { value: '早期修改' } });
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(screen.getByRole('cell', { name: '物件，名稱：早期修改' })).toBeInTheDocument();

    const pinnedResult = { ...full, tables: [activeTable, pinnedTable] };
    await act(async () => resolvePinned(pinnedResult));
    await waitFor(() => expect(screen.getByRole('navigation', { name: '常用表格' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '開啟表格 置底表格' }));
    expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent('置底表格');
    expect(screen.queryByText('背景表格')).not.toBeInTheDocument();

    await act(async () => resolveFull(full));
    await waitFor(() => expect(db.loadWorkspaceHistories).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    expect(within(drawer).getByText('背景表格')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: '關閉目錄' }));
    await user.click(screen.getByRole('button', { name: '開啟目錄' }));
    await user.click(within(screen.getByRole('complementary', { name: 'Workspace 目錄' })).getByText('本機表格'));
    expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent('本機表格');
    expect(screen.getByRole('cell', { name: '物件，名稱：早期修改' })).toBeInTheDocument();
  });

  it('cancels a queued table switch when the early directory closes', async () => {
    const base = await loadWorkspace();
    const otherTable = { ...base.tables[0], id: 'table-2', name: '其他表格' };
    const full = {
      ...base,
      nodes: [...base.nodes, { ...base.nodes[0], id: 'node-2', tableId: otherTable.id, name: otherTable.name, order: 1 }],
      tables: [...base.tables, otherTable],
    };
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: { ...full, tables: base.tables }, complete: false });
    let finishTableLoad!: (value: typeof full) => void;
    vi.mocked(loadWorkspace).mockImplementationOnce(() => new Promise((resolve) => { finishTableLoad = resolve; }));

    render(<WorkspacePage />);
    fireEvent.click(await screen.findByRole('button', { name: '開啟目錄' }));
    fireEvent.click(screen.getByText('其他表格'));
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Workspace 目錄' })).getByRole('button', { name: '關閉目錄' }));

    await act(async () => finishTableLoad(full));
    expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent('本機表格');
    expect(db.saveWorkspace).not.toHaveBeenCalled();
  });

  it('shows editable data before history resolves and reconciles an already persisted early edit exactly once', async () => {
    render(<WorkspacePage />);
    await editBeforeHistoryLoads();
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    const options = db.saveWorkspace.mock.calls[0]?.[1] as { history?: { append?: WorkspaceTableHistoryEntry[] } };
    expect(options.history?.append).toHaveLength(1);
    expect(options.history?.append?.[0]).toEqual(expect.objectContaining({ tableId: 'table-1', action: expect.objectContaining({ type: 'set-cell', rowId: 'row-1', columnId: 'column-1', after: '新值' }) }));
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.getByRole('button', { name: '復原' })).toBeDisabled();
    const entry = options.history!.append![0];
    await act(async () => resolveHistory(new Map([['table-1', { tableId: 'table-1', past: [
      { ...entry, id: 'older', action: { type: 'set-cell', rowId: 'row-1', columnId: 'column-1', before: '更早', after: '原值' } }, entry,
    ], future: [] }]])));
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    expect(screen.getByRole('cell', { name: '物件，名稱：原值' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    expect(screen.getByRole('cell', { name: '物件，名稱：更早' })).toBeInTheDocument();
  });

  it('queues early history for persistence even if the user leaves before hydration completes', async () => {
    const view = render(<WorkspacePage />);
    await editBeforeHistoryLoads();
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    expect((db.saveWorkspace.mock.calls[0]?.[1] as { history?: { append?: WorkspaceTableHistoryEntry[] } }).history?.append).toHaveLength(1);
    view.unmount();
    await act(async () => resolveHistory(new Map()));
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('keeps the table usable when old history cannot be read', async () => {
    db.loadWorkspaceHistories.mockRejectedValue(new Error('history unavailable'));
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByText('先前的復原紀錄讀取失敗，表格仍可使用')).toBeInTheDocument());
    await editBeforeHistoryLoads();
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(db.saveWorkspace).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      history: expect.objectContaining({ replace: expect.any(Array) }),
    }));
  });
});
