import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './WorkspacePage';
import type { WorkspaceTableHistory, WorkspaceTableHistoryEntry } from '../workspace/history';

const db = vi.hoisted(() => ({
  loadWorkspaceHistories: vi.fn(), saveWorkspace: vi.fn(async () => undefined),
  saveWorkspaceHistory: vi.fn(async () => undefined), appendWorkspaceHistoryEntry: vi.fn(async (_entry: WorkspaceTableHistoryEntry) => undefined),
}));
vi.mock('../workspace/backgroundWork', () => ({ afterWorkspacePaint: (work: () => void) => { work(); return () => undefined; } }));
vi.mock('../workspace/db', () => ({
  ...db,
  loadWorkspace: async () => ({
    version: 1, activeNodeId: 'node-1', nodes: [{ id: 'node-1', type: 'table', tableId: 'table-1', name: '本機表格', parentId: null, order: 0 }],
    tables: [{ id: 'table-1', name: '本機表格', rowHeaderName: '項目', updatedAt: 1,
      columns: [{ id: 'column-1', name: '名稱', inputType: 'text', options: [] }],
      rows: [{ id: 'row-1', name: '物件', values: { 'column-1': '原值' } }],
    }],
  }),
  clearAllWorkspaceHistories: vi.fn(), deleteWorkspaceHistories: vi.fn(), flushWorkspaceSaves: vi.fn(),
}));

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
