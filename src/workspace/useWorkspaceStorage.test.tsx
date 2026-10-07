import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveWorkspace } from './db';
import type { WorkspaceData, WorkspaceTable } from './types';
import { useWorkspaceStorage } from './useWorkspaceStorage';

vi.mock('./db', () => ({ saveWorkspace: vi.fn() }));

const table: WorkspaceTable = {
  id: 'table', name: '表格', rowHeaderName: '物件', updatedAt: 1,
  columns: [{ id: 'column', name: '內容', inputType: 'text', options: [] }],
  rows: [{ id: 'row', name: '物件', values: { column: null } }],
};
const initial: WorkspaceData = {
  version: 1, activeNodeId: 'node', tables: [table],
  nodes: [{ id: 'node', type: 'table', name: '表格', parentId: null, order: 0, tableId: 'table' }],
};
const edit = (data: WorkspaceData, value: string): WorkspaceData => ({
  ...data, tables: [{ ...data.tables[0], rows: [{ ...data.tables[0].rows[0], values: { column: value } }] }],
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
    hook.result.current.historyReadyRef.current = historyReady;
    hook.result.current.setHistoryReady(historyReady);
  });
  return { ...hook, notice };
};
beforeEach(() => vi.mocked(saveWorkspace).mockReset());
afterEach(cleanup);

describe('workspace edit and history persistence', () => {
  it.each(['success', 'failure'] as const)('keeps an undo saving while an older edit finishes with %s', async outcome => {
    const first = deferred(), undo = deferred();
    vi.mocked(saveWorkspace).mockReturnValueOnce(first.promise).mockReturnValueOnce(undo.promise);
    const { result, notice } = setup();
    act(() => result.current.commit(edit(initial, 'A')));
    const entry = result.current.historyByTable.get('table')!.past[0];
    act(() => { expect(result.current.moveTableHistory('table', 'undo')).toBe(true); });

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
    act(() => { result.current.moveTableHistory('table', 'undo'); });
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
    act(() => { expect(result.current.moveTableHistory('table', 'undo')).toBe(false); });
    expect(result.current.data!.tables[0].rows[0].values.column).toBe('A');
    expect(saveWorkspace).toHaveBeenCalledTimes(1);
  });
});
