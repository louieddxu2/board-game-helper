import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspaceHistoryEntry, saveWorkspace } from './db';
import type { WorkspaceTableHistoryEntry } from './history';
import type { WorkspaceData, WorkspaceTable } from './types';
import { useWorkspaceStorage } from './useWorkspaceStorage';

vi.mock('./db', () => ({ saveWorkspace: vi.fn(), loadWorkspaceHistoryEntry: vi.fn() }));

const table: WorkspaceTable = {
  id: 'table', name: '表格', rowHeaderName: '物件', updatedAt: 1,
  columns: [{ id: 'column', name: '內容', inputType: 'text', options: [] }],
  rows: [{ id: 'row', name: '物件', values: { column: null } }],
};
const initial: WorkspaceData = {
  version: 1, activeNodeId: 'node', tables: [table],
  nodes: [{ id: 'node', type: 'table', name: '表格', parentId: null, order: 0, tableId: 'table' }],
};
const secondTable: WorkspaceTable = {
  id: 'table-b', name: '第二張表格', rowHeaderName: '物件', updatedAt: 1,
  columns: [{ id: 'column-b', name: '內容', inputType: 'text', options: [] }],
  rows: [{ id: 'row-b', name: '物件 B', values: { 'column-b': null } }],
};
const twoTableInitial: WorkspaceData = {
  ...initial,
  tables: [table, secondTable],
  nodes: [...initial.nodes, { id: 'node-b', type: 'table', name: '第二張表格', parentId: null, order: 1, tableId: secondTable.id }],
};
const editTable = (data: WorkspaceData, tableId: string, value: string): WorkspaceData => ({
  ...data,
  tables: data.tables.map(current => current.id === tableId ? { ...current, rows: [{ ...current.rows[0], values: { ...current.rows[0].values, [current.columns[0].id]: value } }] } : current),
});
const edit = (data: WorkspaceData, value: string): WorkspaceData => ({
  ...editTable(data, 'table', value),
});
const deferred = () => {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const setup = (historyReady = true) => {
  const notice = vi.fn();
  const hook = renderHook(() => useWorkspaceStorage(notice));
  act(() => {
    hook.result.current.dataRef.current = initial;
    hook.result.current.setData(initial);
    hook.result.current.setAllTablesReady(true);
    const loadedIds = historyReady ? new Set(['table']) : new Set<string>();
    hook.result.current.historyLoadedTableIdsRef.current = loadedIds;
    hook.result.current.setHistoryLoadedTableIds(loadedIds);
  });
  return { ...hook, notice };
};
beforeEach(() => {
  vi.mocked(saveWorkspace).mockReset();
  vi.mocked(loadWorkspaceHistoryEntry).mockReset();
});
afterEach(cleanup);

describe('workspace edit and history persistence', () => {
  it.each(['success', 'failure'] as const)('keeps an undo saving while an older edit finishes with %s', async outcome => {
    const first = deferred(), undo = deferred();
    vi.mocked(saveWorkspace).mockReturnValueOnce(first.promise).mockReturnValueOnce(undo.promise);
    const { result, notice } = setup();
    act(() => result.current.commit(edit(initial, 'A')));
    const entry = result.current.historyByTable.get('table')!.past[0];
    let moved = false;
    await act(async () => { moved = await result.current.moveTableHistory('table', 'undo'); });
    expect(moved).toBe(true);

    expect(result.current.data!.tables[0].rows[0].values.column).toBeNull();
    expect(result.current.historyByTable.get('table')).toMatchObject({ past: [], future: [entry] });
    expect(saveWorkspace).toHaveBeenLastCalledWith(result.current.data, expect.objectContaining({
      partial: false, history: expect.objectContaining({ replace: [expect.objectContaining({ past: [], future: [entry] })] }),
    }));
    notice.mockClear();
    await act(async () => { if (outcome === 'success') first.resolve(); else first.reject(new Error('older write')); });
    expect(result.current.saveState).toBe('saving');
    expect(result.current.lastSavedAt).toBeUndefined();
    expect(notice).not.toHaveBeenCalled();
    await act(async () => undo.resolve());
    expect(result.current.saveState).toBe('saved');
    expect(result.current.lastSavedAt).toEqual(expect.any(Number));
  });

  it('retains the latest save error after an older success and clears redo with the next edit', async () => {
    const first = deferred(), undo = deferred();
    vi.mocked(saveWorkspace).mockReturnValueOnce(first.promise).mockReturnValueOnce(undo.promise).mockResolvedValueOnce();
    const { result, notice } = setup();
    act(() => result.current.commit(edit(initial, 'A')));
    await act(async () => { await result.current.moveTableHistory('table', 'undo'); });
    await act(async () => undo.reject(new Error('latest write')));
    expect(result.current.saveState).toBe('error');
    expect(notice).toHaveBeenLastCalledWith('本機儲存失敗，請先匯出資料備份');
    await act(async () => first.resolve());
    expect(result.current.saveState).toBe('error');
    await act(async () => result.current.commit(edit(result.current.data!, 'B')));
    expect(result.current.saveState).toBe('saved');
    expect(result.current.data!.tables[0].rows[0].values.column).toBe('B');
    expect(result.current.historyByTable.get('table')!.past).toHaveLength(1);
    expect(result.current.historyByTable.get('table')!.future).toEqual([]);
  });

  it('appends early edits without replacing unread disk history or enabling undo', async () => {
    vi.mocked(saveWorkspace).mockResolvedValue();
    const { result } = setup(false);
    await act(async () => result.current.commit(edit(initial, 'A')));
    const entry = result.current.historyByTable.get('table')!.past[0];
    const options = vi.mocked(saveWorkspace).mock.calls[0][1]!;
    expect(options.history).toMatchObject({ append: [entry] });
    expect(options.history).not.toHaveProperty('replace');
    let moved = true;
    await act(async () => { moved = await result.current.moveTableHistory('table', 'undo'); });
    expect(moved).toBe(false);
    expect(result.current.data!.tables[0].rows[0].values.column).toBe('A');
    expect(saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('writes loaded history as replace and preserves an unloaded table as append-only', async () => {
    vi.mocked(saveWorkspace).mockResolvedValue();
    const { result } = setup();
    const oldB = { id: 'old-b', label: '磁碟上的舊修改', createdAt: 2 };
    act(() => {
      result.current.dataRef.current = twoTableInitial;
      result.current.setData(twoTableInitial);
      const loaded = new Set(['table']);
      result.current.historyLoadedTableIdsRef.current = loaded;
      result.current.setHistoryLoadedTableIds(loaded);
      result.current.historyRef.current = new Map([
        ['table', { tableId: 'table', past: [], future: [] }],
        ['table-b', { tableId: 'table-b', past: [oldB], future: [] }],
      ]);
      result.current.setHistoryByTable(result.current.historyRef.current);
    });
    const bAction = { type: 'set-cell' as const, rowId: 'row-b', columnId: 'column-b', before: null, after: 'B' };
    act(() => result.current.commit(editTable(twoTableInitial, 'table-b', 'B'), { tableId: 'table-b', label: 'B 修改', action: bAction }));
    const aAction = { type: 'set-cell' as const, rowId: 'row', columnId: 'column', before: null, after: 'A' };
    act(() => result.current.commit(editTable(result.current.data!, 'table', 'A'), { tableId: 'table', label: 'A 修改', action: aAction }));

    const options = vi.mocked(saveWorkspace).mock.calls[1]?.[1];
    expect(options?.history?.replace).toHaveLength(1);
    expect(options?.history?.replace?.[0]?.tableId).toBe('table');
    expect(options?.history?.append).toHaveLength(1);
    expect(options?.history?.append?.[0]).toMatchObject({ id: expect.not.stringMatching('old-b'), tableId: 'table-b', action: bAction });
    expect(options?.history?.replace?.some(history => history.tableId === 'table-b')).toBe(false);
  });

  it('completes two queued undo requests sequentially when no edit supersedes them', async () => {
    vi.mocked(saveWorkspace).mockResolvedValue();
    const { result } = setup();
    const firstReference = { id: 'first-history', label: '第一次', createdAt: 2 };
    const secondReference = { id: 'second-history', label: '第二次', createdAt: 3 };
    const firstEntry: WorkspaceTableHistoryEntry = { ...firstReference, tableId: 'table', action: { type: 'set-cell', rowId: 'row', columnId: 'column', before: null, after: 'A' } };
    const secondEntry: WorkspaceTableHistoryEntry = { ...secondReference, tableId: 'table', action: { type: 'set-cell', rowId: 'row', columnId: 'column', before: 'A', after: 'B' } };
    act(() => {
      const data = edit(initial, 'B');
      result.current.dataRef.current = data;
      result.current.setData(data);
      result.current.historyRef.current = new Map([['table', { tableId: 'table', past: [firstReference, secondReference], future: [] }]]);
      result.current.setHistoryByTable(result.current.historyRef.current);
    });
    vi.mocked(loadWorkspaceHistoryEntry).mockImplementation(async (_tableId, reference) => reference.id === firstReference.id ? firstEntry : secondEntry);

    let firstMoved!: boolean;
    let secondMoved!: boolean;
    const first = result.current.moveTableHistory('table', 'undo');
    const second = result.current.moveTableHistory('table', 'undo');
    await act(async () => { firstMoved = await first; secondMoved = await second; });

    expect(firstMoved).toBe(true);
    expect(secondMoved).toBe(true);
    expect(loadWorkspaceHistoryEntry).toHaveBeenCalledTimes(2);
    expect(result.current.data!.tables[0].rows[0].values.column).toBeNull();
    expect(result.current.historyByTable.get('table')?.past).toEqual([]);
    expect(result.current.historyByTable.get('table')?.future.map(entry => entry.id)).toEqual(['second-history', 'first-history']);
  });

  it('loads a history reference once for undo and reuses the full entry for redo', async () => {
    vi.mocked(saveWorkspace).mockResolvedValue();
    const { result } = setup();
    const reference = { id: 'history-ref', label: '文字修改', createdAt: 2 };
    const entry = { ...reference, tableId: 'table', action: { type: 'set-cell' as const, rowId: 'row', columnId: 'column', before: null, after: '歷史值' } };
    vi.mocked(loadWorkspaceHistoryEntry).mockResolvedValue(entry);
    act(() => {
      const history = { tableId: 'table', past: [reference], future: [] };
      result.current.historyRef.current = new Map([['table', history]]);
      result.current.setHistoryByTable(result.current.historyRef.current);
    });

    let undone = false;
    await act(async () => { undone = await result.current.moveTableHistory('table', 'undo'); });
    expect(undone).toBe(true);
    expect(loadWorkspaceHistoryEntry).toHaveBeenCalledTimes(1);
    expect(result.current.data!.tables[0].rows[0].values.column).toBeNull();

    let redone = false;
    await act(async () => { redone = await result.current.moveTableHistory('table', 'redo'); });
    expect(redone).toBe(true);
    expect(loadWorkspaceHistoryEntry).toHaveBeenCalledTimes(1);
    expect(result.current.data!.tables[0].rows[0].values.column).toBe('歷史值');
  });

  it('does not apply or save when an exact history body fails integrity validation', async () => {
    vi.mocked(saveWorkspace).mockResolvedValue();
    const { result, notice } = setup();
    const reference = { id: 'bad-history', label: '損壞修改', createdAt: 2 };
    act(() => {
      result.current.historyRef.current = new Map([['table', { tableId: 'table', past: [reference], future: [] }]]);
      result.current.setHistoryByTable(result.current.historyRef.current);
    });
    const error = new Error('corrupt history body');
    error.name = 'WorkspaceStorageIntegrityError';
    vi.mocked(loadWorkspaceHistoryEntry).mockRejectedValue(error);

    let moved = true;
    await act(async () => { moved = await result.current.moveTableHistory('table', 'undo'); });

    expect(moved).toBe(false);
    expect(result.current.data!.tables[0].rows[0].values.column).toBeNull();
    expect(result.current.historyByTable.get('table')).toEqual({ tableId: 'table', past: [reference], future: [] });
    expect(saveWorkspace).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith('復原紀錄讀取失敗，請重新開啟此頁面');
  });

  it('cancels a delayed undo when the active node navigates away', async () => {
    vi.mocked(saveWorkspace).mockResolvedValue();
    const reference = { id: 'navigation-history', label: '待復原', createdAt: 2 };
    const entry: WorkspaceTableHistoryEntry = { ...reference, tableId: 'table', action: { type: 'set-cell', rowId: 'row', columnId: 'column', before: null, after: '舊值' } };
    let resolveEntry!: (value: WorkspaceTableHistoryEntry) => void;
    vi.mocked(loadWorkspaceHistoryEntry).mockReturnValue(new Promise(resolve => { resolveEntry = resolve; }));
    const { result } = setup();
    act(() => {
      result.current.historyRef.current = new Map([['table', { tableId: 'table', past: [reference], future: [] }]]);
      result.current.setHistoryByTable(result.current.historyRef.current);
    });
    const move = result.current.moveTableHistory('table', 'undo');
    await act(async () => { await Promise.resolve(); });
    const navigated = { ...initial, activeNodeId: 'node-b', nodes: [...initial.nodes, { id: 'node-b', type: 'table' as const, name: '另一個表格', parentId: null, order: 1, tableId: 'table' }] };
    act(() => result.current.commit(navigated));
    resolveEntry(entry);
    let moved!: boolean;
    await act(async () => { moved = await move; });

    expect(moved).toBe(false);
    expect(result.current.data?.activeNodeId).toBe('node-b');
    expect(result.current.data?.tables[0].rows[0].values.column).toBeNull();
    expect(result.current.historyByTable.get('table')?.past).toEqual([reference]);
  });

  it('cancels queued undo requests when a newer edit wins while the first entry is loading', async () => {
    vi.mocked(saveWorkspace).mockResolvedValue();
    const reference = { id: 'history-ref', label: '舊修改', createdAt: 2 };
    const entry: WorkspaceTableHistoryEntry = { ...reference, tableId: 'table', action: { type: 'set-cell', rowId: 'row', columnId: 'column', before: null, after: '舊值' } };
    let resolveEntry!: (value: WorkspaceTableHistoryEntry) => void;
    const pendingEntry = new Promise<WorkspaceTableHistoryEntry>(resolve => { resolveEntry = resolve; });
    vi.mocked(loadWorkspaceHistoryEntry).mockReturnValue(pendingEntry);
    const { result } = setup();
    act(() => {
      const history = { tableId: 'table', past: [reference], future: [] };
      result.current.historyRef.current = new Map([['table', history]]);
      result.current.setHistoryByTable(result.current.historyRef.current);
    });

    let first!: Promise<boolean>;
    act(() => { first = result.current.moveTableHistory('table', 'undo'); });
    await act(async () => { await Promise.resolve(); });
    expect(loadWorkspaceHistoryEntry).toHaveBeenCalledTimes(1);
    let second!: Promise<boolean>;
    act(() => { second = result.current.moveTableHistory('table', 'undo'); });
    act(() => { result.current.commit(edit(initial, '新值')); });
    resolveEntry(entry);

    let firstMoved!: boolean;
    let secondMoved!: boolean;
    await act(async () => {
      firstMoved = await first;
      secondMoved = await second;
    });
    expect(firstMoved).toBe(false);
    expect(secondMoved).toBe(false);
    expect(loadWorkspaceHistoryEntry).toHaveBeenCalledTimes(1);
    expect(result.current.data!.tables[0].rows[0].values.column).toBe('新值');
  });
});
