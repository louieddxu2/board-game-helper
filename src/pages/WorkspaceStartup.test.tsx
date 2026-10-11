import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './WorkspacePage';
import { loadWorkspace, loadWorkspaceInitial } from '../workspace/db';
import type { WorkspaceTableHistoryEntry } from '../workspace/history';
import * as workspaceModel from '../workspace/model';
import type { WorkspaceData } from '../workspace/types';

type HistoryHead = { tableId: string; past: WorkspaceTableHistoryEntry[]; future: WorkspaceTableHistoryEntry[] };
const db = vi.hoisted(() => ({
  loadWorkspaceHistories: vi.fn(), saveWorkspace: vi.fn(async (_data: unknown, _options?: unknown) => undefined),
  loadWorkspaceHistoryHead: vi.fn(async (tableId: string): Promise<HistoryHead> => ({ tableId, past: [], future: [] })),
  loadWorkspaceHistoryEntry: vi.fn(async () => { throw new Error('history entry not seeded'); }),
  maintainWorkspaceRowPages: vi.fn(async (_tableId: string, _options?: unknown) => undefined),
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
  const loadWorkspaceInitial = vi.fn(async () => ({ data: await loadWorkspace(), complete: true, storageVersion: 4 }));
  return {
  ...db,
  loadWorkspace,
  loadWorkspaceInitial,
  loadWorkspaceBackupSummaries: vi.fn(async (data: WorkspaceData) => data.nodes.flatMap(node => node.type === 'table' && node.tableId ? [{ id: node.tableId, name: node.name, updatedAt: 1 }] : [])),
  assertWorkspaceStorageCurrent: vi.fn(async () => undefined),
};
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

const editBeforeHistoryLoads = async () => {
  const cell = await screen.findByRole('cell', { name: '物件，名稱：原值' });
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.click(cell);
  fireEvent.change(screen.getByRole('textbox', { name: '名稱輸入' }), { target: { value: '新值' } });
  fireEvent.click(screen.getByRole('button', { name: '關閉' }));
  expect(screen.getByRole('cell', { name: '物件，名稱：新值' })).toBeInTheDocument();
};

describe('workspace startup', () => {
  it.each([false, true])('uses the background rebuilt statistics when opening a dynamic list (full fallback: %s)', async (complete) => {
    const base = await loadWorkspace();
    const table = { ...base.tables[0], columns: [{ ...base.tables[0].columns[0], inputType: 'dynamic-select' as const }] };
    const initial = { ...base, tables: [table] };
    const prepared = workspaceModel.ensureTableDynamicOptions(table);
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: initial, complete, storageVersion: 4 });
    let finishLoad!: (value: WorkspaceData) => void;
    vi.mocked(loadWorkspace).mockImplementationOnce(() => new Promise(resolve => { finishLoad = resolve; }));
    render(<WorkspacePage />);
    expect(await screen.findByRole('cell', { name: '物件，名稱：原值' })).toBeInTheDocument();
    expect(db.loadWorkspaceHistories).not.toHaveBeenCalled();
    await act(async () => finishLoad({ ...initial, tables: [prepared] }));
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    await waitFor(() => expect(db.loadWorkspaceHistoryHead).toHaveBeenCalledWith('table-1', expect.objectContaining({ isCurrent: expect.any(Function) })));
    const collect = vi.spyOn(workspaceModel, 'collectDynamicOptionCounts');
    try {
      fireEvent.click(screen.getByRole('cell', { name: '物件，名稱：原值' }));
      expect(screen.getByRole('option', { name: '原值' })).toBeInTheDocument();
      expect(collect).not.toHaveBeenCalled();
    } finally { collect.mockRestore(); }
  });

  it('flushes rebuilt statistics after paint even when the initial fallback loaded all tables', async () => {
    const base = await loadWorkspace();
    vi.mocked(loadWorkspace).mockClear();
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: base, complete: true, storageVersion: 4 });
    render(<WorkspacePage />);
    expect(await screen.findByRole('cell', { name: '物件，名稱：原值' })).toBeInTheDocument();
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledWith({ expectCurrentRevision: true, isCurrent: expect.any(Function) }));
    expect(loadWorkspace).toHaveBeenCalledExactlyOnceWith({ expectCurrentRevision: true, isCurrent: expect.any(Function) });
  });

  it('retains search focus when the directory finishes loading', async () => {
    const base = await loadWorkspace();
    const otherTable = { ...base.tables[0], id: 'table-2', name: '其他表格' };
    const full = { ...base, nodes: [...base.nodes, { ...base.nodes[0], id: 'node-2', tableId: otherTable.id, name: otherTable.name, order: 1 }], tables: [...base.tables, otherTable] };
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: { ...full, tables: base.tables }, complete: false, storageVersion: 4 });
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
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: { ...full, tables: base.tables }, complete: false, storageVersion: 4 });
    let finishTableLoad!: (value: typeof full) => void;
    vi.mocked(loadWorkspace).mockImplementationOnce(() => new Promise((resolve) => { finishTableLoad = resolve; }));

    render(<WorkspacePage />);
    fireEvent.click(await screen.findByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    expect(within(drawer).getByRole('status')).toHaveTextContent('正在讀取其他表格');
    expect(within(drawer).getByLabelText('版本資訊')).toHaveTextContent('版本 開發版 · 儲存格式 v4');
    expect(screen.queryByRole('button', { name: '新增表格' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('其他表格'));
    expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent('本機表格');
    expect(db.saveWorkspace).not.toHaveBeenCalled();

    await act(async () => finishTableLoad(full));
    await waitFor(() => expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent('其他表格'));
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(db.saveWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ activeNodeId: 'node-2' }), expect.objectContaining({
      history: expect.objectContaining({ clearAll: false, deleteTableIds: [] }),
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
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: { ...full, tables: [activeTable] }, complete: false, storageVersion: 4 });
    let resolvePinned!: (value: typeof full) => void;
    let resolveFull!: (value: typeof full) => void;
    vi.mocked(loadWorkspace)
      .mockImplementationOnce((options?: { tableIds?: readonly string[]; isCurrent?: () => boolean }) => {
        expect(options?.tableIds).toEqual(['table-2']);
        return new Promise((resolve) => { resolvePinned = resolve; });
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFull = resolve; }));
    const user = userEvent.setup();
    render(<WorkspacePage />);
    expect(await screen.findByRole('cell', { name: '物件，名稱：原值' })).toBeInTheDocument();
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledWith({ expectCurrentRevision: true, tableIds: ['table-2'], isCurrent: expect.any(Function) }));

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
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    await waitFor(() => expect(db.loadWorkspaceHistoryHead).toHaveBeenCalled());
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
    vi.mocked(loadWorkspaceInitial).mockResolvedValueOnce({ data: { ...full, tables: base.tables }, complete: false, storageVersion: 4 });
    let finishTableLoad!: (value: typeof full) => void;
    let readOptions!: { isCurrent?: () => boolean };
    vi.mocked(loadWorkspace).mockImplementationOnce((options?: { isCurrent?: () => boolean }) => {
      readOptions = options ?? {};
      return new Promise((resolve) => { finishTableLoad = resolve; });
    });

    const view = render(<WorkspacePage />);
    fireEvent.click(await screen.findByRole('button', { name: '開啟目錄' }));
    fireEvent.click(screen.getByText('其他表格'));
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Workspace 目錄' })).getByRole('button', { name: '關閉目錄' }));

    await act(async () => finishTableLoad(full));
    expect(screen.getByRole('button', { name: '重新命名表格' })).toHaveTextContent('本機表格');
    expect(db.saveWorkspace).not.toHaveBeenCalled();
    expect(readOptions.isCurrent).toEqual(expect.any(Function));
    view.unmount();
    expect(readOptions.isCurrent?.()).toBe(false);
  });

  it('loads a history head on first edit and merges an already persisted early edit exactly once', async () => {
    let resolveHead!: (history: HistoryHead) => void;
    db.loadWorkspaceHistoryHead.mockImplementationOnce(() => new Promise<HistoryHead>(resolve => { resolveHead = resolve; }));
    render(<WorkspacePage />);
    await editBeforeHistoryLoads();
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    const options = db.saveWorkspace.mock.calls[0]?.[1] as { history?: { append?: WorkspaceTableHistoryEntry[] } };
    expect(options.history?.append).toHaveLength(1);
    expect(options.history?.append?.[0]).toEqual(expect.objectContaining({ tableId: 'table-1', action: expect.objectContaining({ type: 'set-cell', rowId: 'row-1', columnId: 'column-1', after: '新值' }) }));
    const entry = options.history!.append![0];
    await waitFor(() => expect(db.loadWorkspaceHistoryHead).toHaveBeenCalled());
    await act(async () => resolveHead({ tableId: 'table-1', past: [entry], future: [] }));
    expect(screen.getByRole('button', { name: '復原' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(screen.getByRole('cell', { name: '物件，名稱：原值' })).toBeInTheDocument());
  });

  it('queues an early history append even if the user leaves before the head resolves', async () => {
    let resolveHead!: (history: HistoryHead) => void;
    db.loadWorkspaceHistoryHead.mockImplementationOnce(() => new Promise<HistoryHead>(resolve => { resolveHead = resolve; }));
    const view = render(<WorkspacePage />);
    await editBeforeHistoryLoads();
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    expect((db.saveWorkspace.mock.calls[0]?.[1] as { history?: { append?: WorkspaceTableHistoryEntry[] } }).history?.append).toHaveLength(1);
    await waitFor(() => expect(db.loadWorkspaceHistoryHead).toHaveBeenCalled());
    view.unmount();
    await act(async () => resolveHead({ tableId: 'table-1', past: [], future: [] }));
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('keeps the table usable when old history cannot be read', async () => {
    db.loadWorkspaceHistoryHead.mockRejectedValueOnce(new Error('history unavailable'));
    render(<WorkspacePage />);
    await editBeforeHistoryLoads();
    await waitFor(() => expect(screen.getByText('先前的復原紀錄讀取失敗，表格仍可使用')).toBeInTheDocument());
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(db.saveWorkspace).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      history: expect.objectContaining({ append: expect.any(Array) }),
    }));
  });
});
