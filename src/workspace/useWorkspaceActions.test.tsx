import { useState, type RefObject } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyWorkspaceTableHistoryAction } from './history';
import { getDynamicOptions } from './model';
import { importWorkspaceArchive, importWorkspaceXlsx, type ImportedWorkspace } from './spreadsheet';
import type { WorkspaceColumn, WorkspaceData, WorkspaceTable } from './types';
import { useWorkspaceActions, type WorkspaceTableImportPreview } from './useWorkspaceActions';
import { useWorkspaceDialogs } from './useWorkspaceDialogs';

vi.mock('./spreadsheet', async (importOriginal) => ({
  ...await importOriginal<typeof import('./spreadsheet')>(),
  importWorkspaceXlsx: vi.fn(),
  importWorkspaceArchive: vi.fn(),
}));

const table: WorkspaceTable = { id: 'imported', name: 'Imported', rowHeaderName: '物件', columns: [], rows: [], updatedAt: 0 };
const data: WorkspaceData = {
  version: 1, activeNodeId: null, tables: [],
  nodes: ['A', 'B'].map((id, order) => ({ id, type: 'folder', name: id, parentId: null, order })),
};
const parsedTable = (id: string): ImportedWorkspace => ({ isWorkspace: false, source: 'plain', table: { ...table, id, name: id } });
const deferred = () => {
  let resolve!: (value: ImportedWorkspace) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ImportedWorkspace>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const makeProps = (): Parameters<typeof useWorkspaceActions>[0] => ({
  data, dataRef: { current: data } as RefObject<WorkspaceData | undefined>, table: undefined, rowHeader: undefined,
  commit: vi.fn(), getDynamicOptions, setNotice: vi.fn(), setExpanded: vi.fn(), setDrawerOpen: vi.fn(),
  setTableActionsOpen: vi.fn(), onExported: vi.fn(),
  dialogs: { state: { columnVisibilityOpen: false, pasteDialogOpen: false }, set: vi.fn(), update: vi.fn(), close: vi.fn(), closeCellEditors: vi.fn() },
});

const editableRowHeader: WorkspaceColumn = { id: 'row-header-table-1', name: '物件', inputType: 'text', options: [] };
const editableColumn: WorkspaceColumn = { id: 'column-1', name: '名稱', inputType: 'text', options: [] };
const editableTable: WorkspaceTable = {
  id: 'table-1', name: '可編輯表格', rowHeaderName: editableRowHeader.name, rowHeader: editableRowHeader,
  columns: [editableColumn], rows: [{ id: 'row-1', name: '第一筆', values: { [editableColumn.id]: null } }], updatedAt: 1,
};
const editableData: WorkspaceData = {
  version: 1, activeNodeId: 'node-1', tables: [editableTable],
  nodes: [{ id: 'node-1', type: 'table', name: editableTable.name, parentId: null, order: 0, tableId: editableTable.id }],
};
const makeEditableProps = () => ({ ...makeProps(), data: editableData, dataRef: { current: editableData } as RefObject<WorkspaceData | undefined>, table: editableTable, rowHeader: editableRowHeader });

const actionColumn = { id: 'column-2', name: '備註', inputType: 'text' as const, options: [] };
const actionTable: WorkspaceTable = {
  ...editableTable,
  columns: [editableColumn, actionColumn],
  rows: [
    { id: 'row-1', name: '第一筆', values: { [editableColumn.id]: null, [actionColumn.id]: '保留' } },
    { id: 'row-2', name: '第二筆', values: { [editableColumn.id]: '乙', [actionColumn.id]: null } },
  ],
};
const otherTable: WorkspaceTable = {
  ...editableTable,
  id: 'table-2', name: '另一張表',
  rows: [{ id: 'other-row', name: '其他', values: { [editableColumn.id]: '外部值' } }],
};
const actionData: WorkspaceData = { ...editableData, tables: [actionTable, otherTable] };
const makeActionProps = () => ({
  ...makeProps(), data: actionData, dataRef: { current: actionData } as RefObject<WorkspaceData | undefined>,
  table: actionTable, rowHeader: editableRowHeader,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('Workspace import ownership', () => {
  it('keeps the selected folder through parsing and preview confirmation', async () => {
    const pending = deferred();
    vi.mocked(importWorkspaceXlsx).mockReturnValueOnce(pending.promise);
    const props = makeProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    result.current.importTableParentId.current = 'A';
    const reading = result.current.readImport(new File([], 'table.xlsx'), 'table');
    result.current.importTableParentId.current = 'B';
    await act(async () => { pending.resolve(parsedTable('first')); await reading; });

    const preview = vi.mocked(props.dialogs.set).mock.calls[0][1]! as WorkspaceTableImportPreview;
    expect(preview.parentId).toBe('A');
    act(() => result.current.finishTableImport(preview.table, preview.parentId));
    expect(props.commit).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ tableId: 'first', parentId: 'A' })]),
    }), undefined, { importedTableIds: ['first'] });
  });

  it.each(['replace', 'merge'] as const)('marks only incoming tables for statistics reuse during %s', (mode) => {
    const props = makeEditableProps();
    props.dialogs.state.workspaceImport = { ...data, tables: [table] };
    const { result } = renderHook(() => useWorkspaceActions(props));
    act(() => result.current.finishWorkspaceImport(mode));
    const [next, , options] = vi.mocked(props.commit).mock.calls[0];
    const incoming = next.tables.filter(item => item !== editableTable);
    expect(options).toEqual({ clearAllHistory: true, importedTableIds: incoming.map(item => item.id) });
    expect(incoming).toHaveLength(1);
    if (mode === 'merge') expect(next.tables[0]).toBe(editableTable);
  });

  it.each(['success', 'failure'] as const)('ignores an older table result after the newer selection succeeds (%s)', async (outcome) => {
    const first = deferred();
    const second = deferred();
    vi.mocked(importWorkspaceXlsx).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const props = makeProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    const readingFirst = result.current.readImport(new File([], 'first.xlsx'), 'table');
    const readingSecond = result.current.readImport(new File([], 'second.xlsx'), 'table');
    await act(async () => { second.resolve(parsedTable('second')); await readingSecond; });
    vi.mocked(props.dialogs.set).mockClear();
    vi.mocked(props.setNotice).mockClear();

    await act(async () => {
      if (outcome === 'success') first.resolve(parsedTable('first'));
      else first.reject(new Error('older parser failed'));
      await readingFirst;
    });
    expect(props.dialogs.set).not.toHaveBeenCalled();
    expect(props.setNotice).not.toHaveBeenCalled();
  });

  it('shares latest-selection ownership between table and database files', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(importWorkspaceXlsx).mockReturnValueOnce(first.promise);
    vi.mocked(importWorkspaceArchive).mockReturnValueOnce(second.promise);
    const props = makeProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    const readingFirst = result.current.readImport(new File([], 'first.xlsx'), 'table');
    const readingSecond = result.current.readImport(new File([], 'second.zip'), 'workspace');
    await act(async () => { second.resolve({ isWorkspace: true, source: 'workspace', data }); await readingSecond; });
    await act(async () => { first.resolve(parsedTable('first')); await readingFirst; });
    expect(props.dialogs.set).toHaveBeenCalledWith('workspaceImport', data);
    expect(props.dialogs.set).not.toHaveBeenCalledWith('tableImportPreview', expect.anything());
  });

  it.each(['success', 'failure'] as const)('does not publish a late %s into the surviving host after the import owner unmounts', async (outcome) => {
    const pending = deferred();
    vi.mocked(importWorkspaceXlsx).mockReturnValueOnce(pending.promise);
    let actions!: ReturnType<typeof useWorkspaceActions>;
    const props = makeProps();
    const ImportOwner = ({ setNotice, dialogs }: Pick<typeof props, 'setNotice' | 'dialogs'>) => {
      actions = useWorkspaceActions({ ...props, setNotice, dialogs });
      return null;
    };
    const Host = ({ showOwner }: { showOwner: boolean }) => {
      const [notice, setNotice] = useState('');
      const dialogs = useWorkspaceDialogs(null);
      return <>{showOwner && <ImportOwner setNotice={setNotice} dialogs={dialogs} />}<output data-testid="notice">{notice}</output><output data-testid="preview">{dialogs.state.tableImportPreview?.table.name ?? 'none'}</output></>;
    };
    const view = render(<Host showOwner />);
    let reading!: Promise<void>;
    act(() => { reading = actions.readImport(new File([], 'late.xlsx'), 'table'); });
    const initialNotice = screen.getByTestId('notice').textContent;
    view.rerender(<Host showOwner={false} />);
    await act(async () => {
      if (outcome === 'success') pending.resolve(parsedTable('late'));
      else pending.reject(new Error('late parser failed'));
      await reading;
    });
    expect(screen.getByTestId('preview')).toHaveTextContent('none');
    expect(screen.getByTestId('notice').textContent).toBe(initialNotice);
  });
});

describe('Workspace single-cell editing', () => {
  it('emits an explicit set-cell mutation whose real history action can undo and redo a data-cell edit', () => {
    const props = makeEditableProps();
    const { result } = renderHook(() => useWorkspaceActions(props));

    act(() => result.current.saveCellValue('row-1', editableColumn, '新的內容'));

    const [nextData, mutation] = vi.mocked(props.commit).mock.calls[0];
    expect(mutation).toMatchObject({
      tableId: editableTable.id,
      label: '編輯儲存格',
      action: { type: 'set-cell', rowId: 'row-1', columnId: editableColumn.id, before: null, after: '新的內容' },
    });
    expect(nextData.tables[0].rows[0].values[editableColumn.id]).toBe('新的內容');
    expect(props.dialogs.close).toHaveBeenCalledWith('editing');

    const undo = applyWorkspaceTableHistoryAction(nextData, editableTable.id, mutation!.action, 'undo');
    expect(undo.tables[0].rows[0].values[editableColumn.id]).toBeNull();
    const redo = applyWorkspaceTableHistoryAction(undo, editableTable.id, mutation!.action, 'redo');
    expect(redo.tables[0].rows[0].values[editableColumn.id]).toBe('新的內容');
  });

  it('uses the row-header column and object label for a row-header edit', () => {
    const props = makeEditableProps();
    const { result } = renderHook(() => useWorkspaceActions(props));

    act(() => result.current.saveCellValue('row-1', editableRowHeader, '第二筆'));

    const [nextData, mutation] = vi.mocked(props.commit).mock.calls[0];
    expect(mutation).toMatchObject({
      tableId: editableTable.id,
      label: '編輯物件',
      action: { type: 'set-cell', rowId: 'row-1', columnId: editableRowHeader.id, before: '第一筆', after: '第二筆' },
    });
    expect(nextData.tables[0].rows[0].name).toBe('第二筆');

    const undo = applyWorkspaceTableHistoryAction(nextData, editableTable.id, mutation!.action, 'undo');
    expect(undo.tables[0].rows[0].name).toBe('第一筆');
    const redo = applyWorkspaceTableHistoryAction(undo, editableTable.id, mutation!.action, 'redo');
    expect(redo.tables[0].rows[0].name).toBe('第二筆');
  });

  it.each([
    { label: 'data cell', column: editableColumn, value: null },
    { label: 'row header', column: editableRowHeader, value: '第一筆' },
  ])('does not commit a no-op $label edit but always closes the editor', ({ column, value }) => {
    const props = makeEditableProps();
    const { result } = renderHook(() => useWorkspaceActions(props));

    act(() => result.current.saveCellValue('row-1', column, value));

    expect(props.commit).not.toHaveBeenCalled();
    expect(props.dialogs.close).toHaveBeenCalledWith('editing');
  });

  it('does not commit an edited link whose URL and label are unchanged', () => {
    const linkColumn = { ...editableColumn, inputType: 'link' as const };
    const link = { url: 'https://example.com/game', label: '官網' };
    const linkTable = { ...editableTable, columns: [linkColumn], rows: [{ ...editableTable.rows[0], values: { [linkColumn.id]: link } }] };
    const linkData = { ...editableData, tables: [linkTable] };
    const props = { ...makeEditableProps(), data: linkData, dataRef: { current: linkData } as RefObject<WorkspaceData | undefined>, table: linkTable };
    const { result } = renderHook(() => useWorkspaceActions(props));

    act(() => result.current.saveCellValue('row-1', linkColumn, { label: '官網', url: 'https://example.com/game' }));

    expect(props.commit).not.toHaveBeenCalled();
    expect(props.dialogs.close).toHaveBeenCalledWith('editing');
  });

  it('closes an editor for a missing row without inventing a history entry', () => {
    const props = makeEditableProps();
    const { result } = renderHook(() => useWorkspaceActions(props));

    act(() => result.current.saveCellValue('missing-row', editableColumn, '內容'));

    expect(props.commit).not.toHaveBeenCalled();
    expect(props.dialogs.close).toHaveBeenCalledWith('editing');
  });
});

describe('Workspace structural actions', () => {
  it.each(['row', 'column'] as const)('adds a %s with an explicit history action and keeps other-table references', (kind) => {
    const props = makeActionProps();
    const { result } = renderHook(() => useWorkspaceActions(props));

    act(() => { if (kind === 'row') result.current.addRow(); else result.current.addColumn(); });

    const [next, mutation] = vi.mocked(props.commit).mock.calls[0];
    expect(next.tables[1]).toBe(actionData.tables[1]);
    expect(mutation?.action.type).toBe(kind === 'row' ? 'add-row' : 'add-column');
    if (kind === 'row') {
      const addedRow = next.tables[0].rows.at(-1)!;
      expect(next.tables[0].rows).toHaveLength(3);
      expect(addedRow.values).toEqual({ [editableColumn.id]: null, [actionColumn.id]: null });
      expect(props.dialogs.set).toHaveBeenCalledWith('focusTarget', { rowId: addedRow.id, columnId: editableRowHeader.id });
      const undone = applyWorkspaceTableHistoryAction(next, actionTable.id, mutation!.action, 'undo');
      const redone = applyWorkspaceTableHistoryAction(undone, actionTable.id, mutation!.action, 'redo');
      expect(undone.tables[0].rows).toHaveLength(2);
      expect(redone.tables[0].rows.at(-1)).toBe(addedRow);
    } else {
      const addedColumn = next.tables[0].columns.at(-1)!;
      expect(next.tables[0].columns).toHaveLength(3);
      expect(next.tables[0].rows.every(row => row.values[addedColumn.id] === null)).toBe(true);
      expect(props.dialogs.set).toHaveBeenCalledWith('focusTarget', { rowId: actionTable.rows[0].id, columnId: addedColumn.id });
      const undone = applyWorkspaceTableHistoryAction(next, actionTable.id, mutation!.action, 'undo');
      const redone = applyWorkspaceTableHistoryAction(undone, actionTable.id, mutation!.action, 'redo');
      expect(undone.tables[0].columns).toHaveLength(2);
      expect(redone.tables[0].columns.at(-1)).toBe(addedColumn);
    }
  });

  it.each(['row', 'column'] as const)('takes the latest %s and index when confirming deletion', (kind) => {
    const props = makeActionProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    act(() => {
      if (kind === 'row') result.current.askDeleteRow(actionTable.rows[0], 0);
      else result.current.askDeleteColumn(editableColumn);
    });
    const confirmation = vi.mocked(props.dialogs.set).mock.calls.at(-1)?.[1] as { onConfirm: () => void };
    const latestRow = { ...actionTable.rows[0], name: '確認時名稱', values: { ...actionTable.rows[0].values, [editableColumn.id]: '確認時刪除值', [actionColumn.id]: '確認時值' } };
    const latestColumn = { ...editableColumn, name: '確認時欄位' };
    const latestTable = kind === 'row'
      ? { ...actionTable, rows: [actionTable.rows[1], latestRow] }
      : { ...actionTable, columns: [actionColumn, latestColumn], rows: actionTable.rows.map(row => row.id === latestRow.id ? latestRow : row) };
    const latestOtherTable = { ...otherTable, rows: [{ ...otherTable.rows[0], name: '外部更新' }] };
    props.dataRef.current = { ...actionData, tables: [latestTable, latestOtherTable] };

    act(() => confirmation.onConfirm());
    const [next, mutation] = vi.mocked(props.commit).mock.calls[0];
    expect(next.tables[1]).toBe(latestOtherTable);
    if (kind === 'row') {
      expect(mutation?.action).toMatchObject({ type: 'remove-row', index: 1, row: latestRow });
      expect(next.tables[0].rows).toEqual([actionTable.rows[1]]);
      const undone = applyWorkspaceTableHistoryAction(next, actionTable.id, mutation!.action, 'undo');
      const redone = applyWorkspaceTableHistoryAction(undone, actionTable.id, mutation!.action, 'redo');
      expect(undone.tables[0].rows[1]).toBe(latestRow);
      expect(redone.tables[0].rows).toEqual([actionTable.rows[1]]);
    } else {
      expect(mutation?.action).toMatchObject({ type: 'remove-column', index: 1, column: latestColumn });
      expect((mutation?.action as { values: Record<string, unknown> }).values['row-1']).toBe('確認時刪除值');
      expect(next.tables[0].columns).toEqual([actionColumn]);
      expect(next.tables[0].rows.every(row => !(editableColumn.id in row.values))).toBe(true);
      const undone = applyWorkspaceTableHistoryAction(next, actionTable.id, mutation!.action, 'undo');
      const redone = applyWorkspaceTableHistoryAction(undone, actionTable.id, mutation!.action, 'redo');
      expect(undone.tables[0].rows.every(row => editableColumn.id in row.values)).toBe(true);
      expect(undone.tables[0].rows[0].values[editableColumn.id]).toBe('確認時刪除值');
      expect(redone.tables[0].rows.every(row => !(editableColumn.id in row.values))).toBe(true);
    }
    expect(props.dialogs.close).toHaveBeenCalledWith('confirmDialog');
  });

  it('skips a row deletion when its target disappeared before confirmation', () => {
    const props = makeActionProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    act(() => result.current.askDeleteRow(actionTable.rows[0], 0));
    const confirmation = vi.mocked(props.dialogs.set).mock.calls.at(-1)?.[1] as { onConfirm: () => void };
    props.dataRef.current = { ...actionData, tables: [{ ...actionTable, rows: [actionTable.rows[1]] }, otherTable] };
    act(() => confirmation.onConfirm());
    expect(props.commit).not.toHaveBeenCalled();
  });

  it('skips a column deletion after the active node switches', () => {
    const props = makeActionProps();
    const { result } = renderHook(() => useWorkspaceActions(props));
    act(() => result.current.askDeleteColumn(actionColumn));
    const confirmation = vi.mocked(props.dialogs.set).mock.calls.at(-1)?.[1] as { onConfirm: () => void };
    props.dataRef.current = { ...actionData, activeNodeId: 'node-2' };
    act(() => confirmation.onConfirm());
    expect(props.commit).not.toHaveBeenCalled();
  });
});
