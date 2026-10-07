import type { RefObject } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignWorkspaceChangeRevisions } from './changeRevisions';
import { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import { applyWorkspaceTableHistoryAction, type WorkspaceTableMutation } from './history';
import { createColumn, createTable, emptyWorkspace, getRowHeaderColumn } from './model';
import type { WorkspaceData, WorkspaceTable } from './types';
import { useWorkspaceHiddenFields } from './useWorkspaceHiddenFields';

const makeFixture = () => {
  const table = createTable('隱藏欄位');
  const hiddenDynamic = { ...createColumn('隱藏標籤', 'dynamic-select'), hidden: true };
  const hiddenText = { ...createColumn('隱藏備註'), hidden: true };
  const visible = { ...createColumn('可見欄位'), hidden: false };
  table.columns = [hiddenDynamic, hiddenText, visible];
  table.rows = [{ id: 'row-1', name: '項目', values: {
    [hiddenDynamic.id]: 'A', [hiddenText.id]: '舊備註', [visible.id]: '保留',
  } }];
  const data: WorkspaceData = {
    ...emptyWorkspace(), activeNodeId: 'node-1', tables: [table],
    nodes: [{ id: 'node-1', type: 'table', name: table.name, parentId: null, order: 0, tableId: table.id }],
  };
  return { table, data, hiddenDynamic, hiddenText, visible };
};

afterEach(cleanup);

describe('workspace hidden field edits', () => {
  it('commits all changed hidden columns once, ignores visible values, and supports one undo/redo', () => {
    const { table, data, hiddenDynamic, hiddenText, visible } = makeFixture();
    const dataRef = { current: data } as RefObject<WorkspaceData | undefined>;
    const commit = vi.fn();
    const dialogs = { set: vi.fn(), close: vi.fn() };
    const { result } = renderHook(() => useWorkspaceHiddenFields({
      dataRef, commit, rowHeader: getRowHeaderColumn(table), withActiveTable: (work) => work(), dialogs,
    }));

    act(() => result.current.saveHiddenFields('row-1', {
      [hiddenDynamic.id]: 'B', [hiddenText.id]: '新備註', [visible.id]: '不應寫入',
    }));

    expect(commit).toHaveBeenCalledTimes(1);
    const [nextData, mutation] = commit.mock.calls[0] as [WorkspaceData, WorkspaceTableMutation];
    const nextRow = nextData.tables[0].rows[0];
    expect(nextRow.values).toMatchObject({ [hiddenDynamic.id]: 'B', [hiddenText.id]: '新備註', [visible.id]: '保留' });
    expect(mutation).toMatchObject({ tableId: table.id, label: '編輯隱藏欄位', action: { type: 'paste-range', addedRows: [], addedColumns: [] } });
    expect(mutation.action.type === 'paste-range' && mutation.action.changes.map(change => change.columnId)).toEqual([hiddenDynamic.id, hiddenText.id]);
    expect(dialogs.close).toHaveBeenCalledWith('hiddenFieldsEditor');

    const preparedBefore = assignWorkspaceChangeRevisions(undefined, data);
    const cache = new WorkspaceDynamicOptionsCache();
    const preparedInitial = cache.prepare(undefined, preparedBefore);
    const action = mutation.action;
    const preparedAfter = cache.prepare(preparedInitial, assignWorkspaceChangeRevisions(preparedInitial, applyWorkspaceTableHistoryAction(preparedInitial, table.id, action, 'redo')), { tableId: table.id, action }, 'redo');
    expect(cache.getOptions(preparedAfter.tables[0], hiddenDynamic.id)).toEqual(['B']);

    const preparedUndo = cache.prepare(preparedAfter, assignWorkspaceChangeRevisions(preparedAfter, applyWorkspaceTableHistoryAction(preparedAfter, table.id, action, 'undo')), { tableId: table.id, action }, 'undo');
    expect(preparedUndo.tables[0].rows[0].values).toMatchObject({ [hiddenDynamic.id]: 'A', [hiddenText.id]: '舊備註', [visible.id]: '保留' });
    expect(cache.getOptions(preparedUndo.tables[0], hiddenDynamic.id)).toEqual(['A']);
    const preparedRedo = cache.prepare(preparedUndo, assignWorkspaceChangeRevisions(preparedUndo, applyWorkspaceTableHistoryAction(preparedUndo, table.id, action, 'redo')), { tableId: table.id, action }, 'redo');
    expect(preparedRedo.tables[0].rows[0].values).toMatchObject({ [hiddenDynamic.id]: 'B', [hiddenText.id]: '新備註', [visible.id]: '保留' });
    expect(cache.getOptions(preparedRedo.tables[0], hiddenDynamic.id)).toEqual(['B']);
  });

  it('does not commit a no-op hidden edit', () => {
    const { table, data, hiddenDynamic, hiddenText, visible } = makeFixture();
    const dataRef = { current: data } as RefObject<WorkspaceData | undefined>;
    const commit = vi.fn();
    const { result } = renderHook(() => useWorkspaceHiddenFields({
      dataRef, commit, rowHeader: getRowHeaderColumn(table), withActiveTable: (work) => work(), dialogs: { set: vi.fn(), close: vi.fn() },
    }));

    act(() => result.current.saveHiddenFields('row-1', {
      [hiddenDynamic.id]: 'A', [hiddenText.id]: '舊備註', [visible.id]: '可變但不可見',
    }));

    expect(commit).not.toHaveBeenCalled();
  });
});
