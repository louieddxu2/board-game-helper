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
      id: 'table-1', name: '測試表格', rowHeaderName: '物件', updatedAt: 0,
      columns: [{ id: 'column-text', name: '名稱', inputType: 'text', options: [] }],
      rows: [{ id: 'row-1', name: '花火', values: { 'column-text': null } }],
    }],
  }),
  saveWorkspace: vi.fn(async () => undefined),
  loadWorkspaceHistories: vi.fn(async () => new Map()),
  saveWorkspaceHistory: vi.fn(async () => undefined),
  clearAllWorkspaceHistories: vi.fn(async () => undefined),
  deleteWorkspaceHistories: vi.fn(async () => undefined),
  flushWorkspaceSaves: vi.fn(async () => undefined),
}));

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('Workspace browser back behavior', () => {
  it('closes a cell editor without saving its draft', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，名稱：空白' });

    await user.click(cell);
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), '尚未儲存');
    fireEvent(window, new PopStateEvent('popstate'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument();
    expect(saveWorkspace).not.toHaveBeenCalled();
  });

  it('cancels search and filter state when no modal is above it', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '搜尋' }));
    await user.type(screen.getByRole('searchbox', { name: '搜尋此表' }), '不存在');
    expect(screen.queryByRole('row', { name: /花火/ })).not.toBeInTheDocument();

    fireEvent(window, new PopStateEvent('popstate'));

    await waitFor(() => expect(screen.queryByRole('searchbox', { name: '搜尋此表' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '開啟目錄' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /花火/ })).toBeInTheDocument();
  });
});
