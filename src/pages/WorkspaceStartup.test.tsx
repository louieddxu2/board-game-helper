import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './WorkspacePage';
import { loadWorkspace, loadWorkspaceInitial } from '../workspace/db';
import type { WorkspaceTableHistory, WorkspaceTableHistoryEntry } from '../workspace/history';

const db = vi.hoisted(() => ({
  loadWorkspaceHistories: vi.fn(), saveWorkspace: vi.fn(async () => undefined),
  saveWorkspaceHistory: vi.fn(async () => undefined), appendWorkspaceHistoryEntry: vi.fn(async (_entry: WorkspaceTableHistoryEntry) => undefined),
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
  clearAllWorkspaceHistories: vi.fn(), deleteWorkspaceHistories: vi.fn(), flushWorkspaceSaves: vi.fn(),
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
    expect(db.appendWorkspaceHistoryEntry).toHaveBeenCalledTimes(1);
    expect(db.saveWorkspace).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(screen.getByRole('button', { name: '復原' })).toBeDisabled();
    const entry = db.appendWorkspaceHistoryEntry.mock.calls[0][0];
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
    expect(db.appendWorkspaceHistoryEntry).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => resolveHistory(new Map()));
    expect(db.saveWorkspaceHistory).not.toHaveBeenCalled();
  });

  it('keeps the table usable when old history cannot be read', async () => {
    db.loadWorkspaceHistories.mockRejectedValue(new Error('history unavailable'));
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByText('先前的復原紀錄讀取失敗，表格仍可使用')).toBeInTheDocument());
    await editBeforeHistoryLoads();
    expect(db.saveWorkspaceHistory).toHaveBeenCalledTimes(1);
  });
});
