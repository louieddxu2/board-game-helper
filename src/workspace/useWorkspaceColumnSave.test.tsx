import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignWorkspaceChangeRevisions } from './changeRevisions';
import { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import * as model from './model';
import type { WorkspaceData } from './types';
import { useWorkspaceColumnSave } from './useWorkspaceColumnSave';

const fixture = (count = 200) => {
  const table = model.createTable('測試');
  table.columns = [model.createColumn('數量', 'number')];
  table.rows = Array.from({ length: count }, (_, index) => ({ id: `r${index}`, name: `項目 ${index}`, values: { [table.columns[0].id]: index % 2 } }));
  const node = model.createNode('table', table.name, null, 0, table.id);
  const data: WorkspaceData = { ...model.emptyWorkspace(), nodes: [node], activeNodeId: node.id, tables: [table] };
  const props: Parameters<typeof useWorkspaceColumnSave>[0] = {
    dataRef: { current: data }, table, commit: vi.fn(),
    dialogs: { state: { columnVisibilityOpen: false, pasteDialogOpen: false, configuring: { column: table.columns[0], isRowHeader: false } }, set: vi.fn(), update: vi.fn(), close: vi.fn(), closeCellEditors: vi.fn() },
  };
  return { props, data, table, draft: { ...table.columns[0], inputType: 'dynamic-select' as const } };
};

const forceSlices = () => {
  vi.useFakeTimers();
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed += 4);
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('saving a column draft', () => {
  it('yields before committing once, preserves newer workspace metadata, and primes final counts without counting twice', async () => {
    forceSlices();
    const { props, data, table, draft } = fixture(10_000);
    const { result } = renderHook(() => useWorkspaceColumnSave(props));
    const saving = result.current(draft);
    expect(props.commit).not.toHaveBeenCalled();
    expect(table.rows[0].values[draft.id]).toBe(0);
    const folder = model.createNode('folder', '新資料夾', null, 1);
    props.dataRef.current = { ...data, nodes: [...data.nodes, folder] };
    await act(async () => { await vi.runAllTimersAsync(); await saving; });
    expect(props.commit).toHaveBeenCalledOnce();
    const [next, mutation, options] = vi.mocked(props.commit).mock.calls[0];
    expect(next.nodes).toContain(folder);
    expect(next.tables[0].rows.at(-1)?.values[draft.id]).toBe('1');
    expect(next.tables[0].columns[0].dynamicOptions?.counts.map(item => item.count)).toEqual([5_000, 5_000]);
    expect(options?.preparedTableIds).toEqual([table.id]);
    const collect = vi.spyOn(model, 'collectDynamicOptionCounts');
    const cache = new WorkspaceDynamicOptionsCache();
    cache.primePreparedTables(next, options!.preparedTableIds!);
    const committed = cache.prepare(data, assignWorkspaceChangeRevisions(data, next), mutation);
    expect(cache.getOptions(committed.tables[0], draft.id)).toEqual(['0', '1']);
    expect(committed.tables[0].columns[0].dynamicOptions?.counts.map(item => item.count)).toEqual([5_000, 5_000]);
    expect(collect).not.toHaveBeenCalled();
    expect(props.dialogs.close).toHaveBeenCalledWith('configuring');
  });

  it.each(['cancel', 'navigate', 'unmount'] as const)('does not publish a partial conversion after %s', async reason => {
    forceSlices();
    const { props, data, draft } = fixture();
    const { result, rerender, unmount } = renderHook(value => useWorkspaceColumnSave(value), { initialProps: props });
    const saving = result.current(draft);
    if (reason === 'cancel') rerender({ ...props, dialogs: { ...props.dialogs, state: { ...props.dialogs.state, configuring: undefined } } });
    if (reason === 'navigate') props.dataRef.current = { ...data, activeNodeId: 'another-node' };
    if (reason === 'unmount') unmount();
    await act(async () => { await vi.runAllTimersAsync(); await saving; });
    expect(props.commit).not.toHaveBeenCalled();
    expect(props.dialogs.close).not.toHaveBeenCalled();
    expect(data.tables[0].columns[0].inputType).toBe('number');
  });

  it('rejects a newer table edit and leaves its data intact', async () => {
    forceSlices();
    const { props, data, table, draft } = fixture();
    const { result } = renderHook(() => useWorkspaceColumnSave(props));
    const saving = result.current(draft);
    const edited = { ...table, rows: table.rows.map((row, index) => index ? row : { ...row, values: { [draft.id]: 42 } }) };
    props.dataRef.current = { ...data, tables: [edited] };
    let failure: string | void;
    await act(async () => { await vi.runAllTimersAsync(); failure = await saving; });
    expect(failure!).toContain('表格已有變更');
    expect(props.commit).not.toHaveBeenCalled();
    expect(props.dataRef.current.tables[0]).toBe(edited);
  });

  it('only publishes the latest concurrent save', async () => {
    forceSlices();
    const { props, draft } = fixture();
    const { result } = renderHook(() => useWorkspaceColumnSave(props));
    const old = result.current({ ...draft, name: '舊設定' });
    const current = result.current({ ...draft, name: '新設定' });
    await act(async () => { await vi.runAllTimersAsync(); await Promise.all([old, current]); });
    expect(props.commit).toHaveBeenCalledOnce();
    expect(vi.mocked(props.commit).mock.calls[0][0].tables[0].columns[0].name).toBe('新設定');
  });

  it('does not commit any converted cells when one value is invalid', async () => {
    const { props, table } = fixture();
    const column = { ...table.columns[0], inputType: 'text' as const };
    table.columns = [column];
    table.rows = table.rows.map((row, index) => ({ ...row, values: { [column.id]: index === 199 ? '無法轉換' : '12' } }));
    const { result } = renderHook(() => useWorkspaceColumnSave(props));
    let failure: string | void;
    await act(async () => { failure = await result.current({ ...column, inputType: 'number' }); });
    expect(failure!).toContain('1 筆資料無法轉換');
    expect(props.commit).not.toHaveBeenCalled();
    expect(table.rows[0].values[column.id]).toBe('12');
    expect(table.columns[0].inputType).toBe('text');
  });
});
