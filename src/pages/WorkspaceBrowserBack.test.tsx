import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveWorkspace } from '../workspace/db';
import { uiHistory } from '../workspace/uiHistory';
import { WorkspacePage } from './WorkspacePage';

vi.mock('../workspace/db', () => {
  const loadWorkspace = async () => ({
    version: 1,
    activeNodeId: 'node-table',
    nodes: [{ id: 'node-table', type: 'table', name: '測試表格', parentId: null, order: 0, tableId: 'table-1' }],
    tables: [{
      id: 'table-1', name: '測試表格', rowHeaderName: '物件', updatedAt: 0,
      columns: [{ id: 'column-text', name: '名稱', inputType: 'text', options: [] }],
      rows: [{ id: 'row-1', name: '花火', values: { 'column-text': null } }],
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
  saveWorkspaceHistory: vi.fn(async () => undefined),
  appendWorkspaceHistoryEntry: vi.fn(async () => undefined),
  clearAllWorkspaceHistories: vi.fn(async () => undefined),
  deleteWorkspaceHistories: vi.fn(async () => undefined),
  flushWorkspaceSaves: vi.fn(async () => undefined),
};
});

const historyKey = '__boardGameHelperWorkspaceUi';
let baselineHistoryState: unknown;
let baselineHistoryUrl = '';
let popCount = 0;
const capturePop = () => { popCount += 1; };
const marker = () => (window.history.state as Record<string, unknown> | null)?.[historyKey];
const historyIndex = (state: unknown) => state && typeof state === 'object' && typeof (state as { idx?: unknown }).idx === 'number'
  ? (state as { idx: number }).idx : 0;
const startHistoryCase = () => {
  const index = historyIndex(window.history.state);
  window.history.pushState({ ...(window.history.state ?? {}), idx: index + 1 }, '', '/__workspace-back-previous');
  window.history.pushState({ ...(window.history.state ?? {}), idx: index + 2 }, '', '/__workspace-back-current');
};

beforeEach(() => {
  uiHistory.dispose();
  window.localStorage.clear();
  vi.mocked(saveWorkspace).mockClear();
  baselineHistoryState = window.history.state;
  baselineHistoryUrl = window.location.href;
  startHistoryCase();
  popCount = 0;
  window.addEventListener('popstate', capturePop, true);
});
afterEach(async () => {
  cleanup();
  await waitFor(() => expect(marker()).toBeUndefined(), { timeout: 1500 });
  uiHistory.dispose();
  window.removeEventListener('popstate', capturePop, true);
  window.history.replaceState(baselineHistoryState, '', baselineHistoryUrl);
});

describe('Workspace browser back behavior', () => {
  it('closes a cell editor without saving its draft', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，名稱：空白' });

    await user.click(cell);
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), '尚未儲存');
    const before = popCount;
    act(() => window.history.back());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(popCount).toBeGreaterThan(before));
    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument();
    expect(saveWorkspace).not.toHaveBeenCalled();
  });

  it('cancels search and filter state when no modal is above it', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '搜尋' }));
    await user.type(screen.getByRole('searchbox', { name: '搜尋此表' }), '不存在');
    expect(screen.queryByRole('row', { name: /花火/ })).not.toBeInTheDocument();

    const before = popCount;
    act(() => window.history.back());

    await waitFor(() => expect(screen.queryByRole('searchbox', { name: '搜尋此表' })).not.toBeInTheDocument());
    await waitFor(() => expect(popCount).toBeGreaterThan(before));
    expect(screen.getByRole('button', { name: '開啟目錄' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /花火/ })).toBeInTheDocument();
  });

  it('closes the node menu before the drawer on successive browser Back actions', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '開啟目錄' }));
    await screen.findByRole('complementary', { name: 'Workspace 目錄' });
    await user.click(screen.getByRole('button', { name: '開啟測試表格操作' }));
    expect(screen.getByRole('dialog', { name: '測試表格' })).toBeInTheDocument();

    const firstBack = popCount;
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '測試表格' })).not.toBeInTheDocument());
    await waitFor(() => expect(popCount).toBeGreaterThan(firstBack));
    expect(screen.getByRole('complementary', { name: 'Workspace 目錄' })).toBeInTheDocument();

    const secondBack = popCount;
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Workspace 目錄' })).not.toBeInTheDocument());
    await waitFor(() => expect(popCount).toBeGreaterThan(secondBack));
  });
});
