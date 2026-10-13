import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createColumn, createNode, createTable, emptyWorkspace, getRowHeaderColumn } from '../model';
import { useWorkspaceActions } from '../useWorkspaceActions';
import { useWorkspaceBulkSelection } from '../useWorkspaceBulkSelection';
import { useWorkspaceHiddenFields } from '../useWorkspaceHiddenFields';
import { HiddenFieldsDialog } from '../workspaceBasicDialogs';
import { createWorkspaceValueReader } from './values';
import { evaluateWorkspaceFormula } from './evaluation';
import type { WorkspaceColumn, WorkspaceTable } from '../types';

const fixture = () => {
  const source = { ...createColumn('價格', 'number'), id: 'price', hidden: true };
  const calculated: WorkspaceColumn = { ...createColumn('雙倍', 'number'), id: 'computed', hidden: true, formula: { version: 1, expression: '[價格] * 2', variables: { 價格: { columnId: source.id } } } };
  const table: WorkspaceTable = { ...createTable('防護'), columns: [source, calculated], rows: [{ id: 'row', name: '項目', values: { price: 10 } }] };
  const node = createNode('table', table.name, null, 0, table.id);
  const data = { ...emptyWorkspace(), tables: [table], nodes: [node], activeNodeId: node.id };
  const dialogs = { state: { columnVisibilityOpen: false, pasteDialogOpen: false }, set: vi.fn(), update: vi.fn(), close: vi.fn(), closeCellEditors: vi.fn() };
  return { table, data, dataRef: { current: data }, rowHeader: getRowHeaderColumn(table), dialogs, commit: vi.fn(), setNotice: vi.fn() };
};
afterEach(cleanup);

it('blocks direct writes, editing and source deletion through action handlers', () => {
  const props = fixture();
  const { result } = renderHook(() => useWorkspaceActions({ ...props, getDynamicOptions: () => [], setExpanded: vi.fn(), setDrawerOpen: vi.fn(), setTableActionsOpen: vi.fn(), onExported: vi.fn() }));
  const computed = props.table.columns[1];
  act(() => result.current.saveCellValue('row', computed, 500));
  act(() => result.current.updateCell('row', computed, '500'));
  act(() => result.current.openCell(props.table.rows[0], computed));
  act(() => expect(result.current.askDeleteColumn(props.table.columns[0])).toBe(false));
  expect(props.commit).not.toHaveBeenCalled();
  expect(props.dialogs.set).not.toHaveBeenCalled();
  expect(props.setNotice).toHaveBeenCalledWith(expect.stringContaining('公式'));
});

it('blocks bulk selection of computed cells', () => {
  const props = fixture();
  const { result } = renderHook(() => useWorkspaceBulkSelection({ ...props, filteredRows: props.table.rows, setSearchOpen: vi.fn(), setEditBarOpen: vi.fn(), setTableActionsOpen: vi.fn() }));
  act(() => expect(result.current.startBulkSelection('row', 'computed')).toBe(false));
  expect(result.current.bulkSelection).toBeUndefined();
  expect(props.commit).not.toHaveBeenCalled();
});

it('previews hidden calculated fields from draft inputs and saves only source changes', () => {
  const props = fixture();
  const { result } = renderHook(() => useWorkspaceHiddenFields({ ...props, withActiveTable: work => work() }));
  render(<HiddenFieldsDialog title="項目" row={props.table.rows[0]} columns={props.table.columns} optionsByColumn={{}} onSave={values => result.current.saveHiddenFields('row', { ...values, computed: 999 })} />);
  expect(screen.getByLabelText('雙倍計算結果')).toHaveTextContent('20');
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '15' } });
  expect(screen.getByLabelText('雙倍計算結果')).toHaveTextContent('30');
  fireEvent.click(document.querySelector('.workspace-overlay')!);
  const saved = props.commit.mock.calls[0][0].tables[0];
  expect(saved.rows[0].values.price).toBe(15);
  expect(saved.rows[0].values.computed).toBeUndefined();
});

it('releases cached rows and removed formula columns', () => {
  const props = fixture(), evaluate = vi.fn(evaluateWorkspaceFormula), reader = createWorkspaceValueReader(evaluate);
  reader.read(props.table.rows[0], props.table.columns[1]);
  reader.retainRows(new Set());
  reader.read(props.table.rows[0], props.table.columns[1]);
  expect(evaluate).toHaveBeenCalledTimes(2);
  reader.retainColumns(new Set());
  reader.read(props.table.rows[0], props.table.columns[1]);
  expect(evaluate).toHaveBeenCalledTimes(3);
});
