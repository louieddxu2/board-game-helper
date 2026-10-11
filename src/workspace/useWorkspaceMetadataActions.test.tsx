import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNode, createTable, emptyWorkspace, getDynamicOptions } from './model';
import { useWorkspaceActions } from './useWorkspaceActions';

afterEach(cleanup);
const fixture = () => {
  const active = createTable('已載入');
  const target = createTable('未載入');
  const folder = createNode('folder', '資料夾', null, 0);
  const targetNode = createNode('table', target.name, null, 1, target.id);
  const data = { ...emptyWorkspace(), tables: [active], nodes: [folder, targetNode] };
  const props: Parameters<typeof useWorkspaceActions>[0] = {
    data, dataRef: { current: data }, table: active, rowHeader: active.rowHeader,
    commit: vi.fn(), getDynamicOptions, setNotice: vi.fn(), setExpanded: vi.fn(), setDrawerOpen: vi.fn(), setTableActionsOpen: vi.fn(), onExported: vi.fn(),
    dialogs: { state: { columnVisibilityOpen: false, pasteDialogOpen: false }, set: vi.fn(), update: vi.fn(), close: vi.fn(), closeCellEditors: vi.fn() },
  };
  return { props, data, active, target, folder, targetNode };
};

describe('metadata actions during partial loading', () => {
  it('renames the hydrated target definition and preserves tables loaded after the dialog opened', () => {
    const { props, data, target, targetNode } = fixture();
    props.dialogs.state.nameDialog = { mode: 'rename', initialValue: target.name, node: targetNode };
    const { result } = renderHook(() => useWorkspaceActions(props));
    props.dataRef.current = { ...data, tables: [...data.tables, target] };
    act(() => result.current.submitName('更名'));
    const next = vi.mocked(props.commit).mock.calls[0][0];
    expect(next.tables.map(table => table.name)).toEqual(['已載入', '更名']);
    expect(next.nodes.find(node => node.id === targetNode.id)?.name).toBe('更名');
  });

  it('does not save an unloaded table under inconsistent node and definition names', () => {
    const { props, target, targetNode } = fixture();
    props.dialogs.state.nameDialog = { mode: 'rename', initialValue: target.name, node: targetNode };
    const { result } = renderHook(() => useWorkspaceActions(props));
    act(() => result.current.submitName('更名'));
    expect(props.commit).not.toHaveBeenCalled();
    expect(props.dialogs.close).not.toHaveBeenCalled();
  });

  it('creates folders and relocates unloaded table nodes without losing newer loaded data', () => {
    const { props, data, target, targetNode, folder } = fixture();
    props.dialogs.state.nameDialog = { mode: 'folder', initialValue: '', parentId: null };
    const { result } = renderHook(() => useWorkspaceActions(props));
    props.dataRef.current = { ...data, tables: [...data.tables, target] };
    act(() => result.current.submitName('新資料夾'));
    const created = vi.mocked(props.commit).mock.calls[0][0];
    expect(created.tables).toBe(props.dataRef.current.tables);
    expect(created.nodes.at(-1)?.name).toBe('新資料夾');
    act(() => result.current.relocateNode(targetNode, folder.id));
    const moved = vi.mocked(props.commit).mock.calls[1][0];
    expect(moved.tables).toBe(props.dataRef.current.tables);
    expect(moved.nodes.find(node => node.id === targetNode.id)?.parentId).toBe(folder.id);
  });
});
