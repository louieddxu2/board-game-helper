import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createNode, createTable } from '../model';
import type { WorkspaceData } from '../types';
import { workspaceBackupTableSummary } from '../workspaceBackupSource';
import { useWorkspaceBackupSummaries } from './useWorkspaceBackupSummaries';

const fixture = () => {
  const tables = [createTable('已載入'), createTable('尚未開啟')];
  const data: WorkspaceData = { version: 1, structureRevision: 'structure', nodes: tables.map((table, index) => createNode('table', table.name, null, index, table.id)), tables: [tables[0]], activeNodeId: null };
  return { data, tables, load: vi.fn(async () => tables.map(workspaceBackupTableSummary)) };
};
describe('backup summary inspection', () => {
  it('defers header reads until inspection and reuses them across resident edits', async () => {
    const { data, tables, load } = fixture();
    const hook = renderHook(({ value, enabled }) => useWorkspaceBackupSummaries(value, enabled, load), { initialProps: { value: data, enabled: false } });
    expect(load).not.toHaveBeenCalled();
    hook.rerender({ value: data, enabled: true });
    await waitFor(() => expect(hook.result.current.tables).toHaveLength(2));
    const edited = { ...tables[0], changeRevision: 'new-edit' };
    hook.rerender({ value: { ...data, tables: [edited] }, enabled: true });
    expect(hook.result.current.tables?.find(table => table.id === edited.id)?.changeRevision).toBe('new-edit');
    expect(load).toHaveBeenCalledTimes(1);
    expect(hook.result.current.tables?.some(table => 'rows' in table)).toBe(false);
  });
  it('discards an obsolete directory after a table is removed', async () => {
    const { data, tables } = fixture();
    let finish!: (value: ReturnType<typeof workspaceBackupTableSummary>[]) => void;
    const load = vi.fn(() => new Promise<ReturnType<typeof workspaceBackupTableSummary>[]>(resolve => { finish = resolve; }));
    const hook = renderHook(value => useWorkspaceBackupSummaries(value, true, load), { initialProps: data });
    hook.rerender({ ...data, structureRevision: 'deleted', nodes: [data.nodes[0]] });
    await act(async () => { finish(tables.map(workspaceBackupTableSummary)); });
    expect(hook.result.current.tables).toEqual([workspaceBackupTableSummary(tables[0])]);
  });
  it('keeps an incomplete catalog unavailable after a read failure and retries on new data', async () => {
    const { data, tables, load } = fixture();
    load.mockRejectedValueOnce(new Error('header failed'));
    const hook = renderHook(value => useWorkspaceBackupSummaries(value, true, load), { initialProps: data });
    await waitFor(() => expect(hook.result.current.error).toBe('header failed'));
    expect(hook.result.current.tables).toBeUndefined();
    hook.rerender({ ...data });
    await waitFor(() => expect(hook.result.current.tables).toEqual(tables.map(workspaceBackupTableSummary)));
    expect(hook.result.current.error).toBeUndefined();
  });
});
