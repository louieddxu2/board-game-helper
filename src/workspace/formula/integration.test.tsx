import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareWorkspaceColumnSave } from '../columnConversion';
import { applyWorkspaceTableHistoryAction } from '../history';
import { createColumn, createNode, createTable, emptyWorkspace, getRowHeaderColumn, normalizeWorkspace } from '../model';
import { exportWorkspaceArchive, exportWorkspaceXlsx, importWorkspaceArchive, importWorkspaceXlsx } from '../spreadsheet';
import { readStoredXlsx, tableDataRows, tableSettingsRows } from '../spreadsheetCodec';
import { useWorkspaceFilter } from '../useWorkspaceFilter';
import { ColumnConfig } from '../workspaceColumnConfig';
import { applyWorkspaceMatrixPaste } from '../workspacePaste';
import { createWorkspaceValueReader } from './values';
import { evaluateWorkspaceFormula } from './evaluation';
import { normalizeWorkspaceFormula, validateWorkspaceFormulaColumns } from './configuration';
import type { WorkspaceFormula, WorkspaceTable } from '../types';

const formula = (expression = '[價格] ÷ [次數]'): WorkspaceFormula => ({ version: 1, expression, variables: { 價格: { columnId: 'price' }, 次數: { columnId: 'count' } } });
const roundedFormula = (expression = '[價格] ÷ [次數]', decimalPlaces = 2): WorkspaceFormula => ({ ...formula(expression), decimalPlaces });
const fixture = (): WorkspaceTable => ({ ...createTable('自動屬性'), columns: [
  { ...createColumn('價格', 'number'), id: 'price', numberInputMode: 'input' },
  { ...createColumn('次數', 'number'), id: 'count', numberInputMode: 'input' },
  { ...createColumn('平均', 'number'), id: 'average', formula: formula() },
], rows: [
  { id: 'first', name: '甲', values: { price: 1200, count: 6 } },
  { id: 'second', name: '乙', values: { price: 1200, count: 12 } },
  { id: 'error', name: '丙', values: { price: 'invalid', count: 1 } },
] });
const asData = (table: WorkspaceTable) => { const node = createNode('table', table.name, null, 0, table.id); return { ...emptyWorkspace(), nodes: [node], tables: [table], activeNodeId: node.id }; };
afterEach(() => { cleanup(); localStorage.clear(); });

describe('formula settings and conversions', () => {
  it('inserts buttons at the caret, replaces a selection, has no number keys, and saves only used bindings', async () => {
    const table = fixture(), onSave = vi.fn();
    const manual = { ...table.columns[2], formula: undefined };
    render(<ColumnConfig column={manual} sourceColumns={table.columns} previewRow={table.rows[0]} onSave={onSave} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '公式' }));
    const text = screen.getByRole('textbox', { name: '計算公式' }) as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: '10 + 2' } });
    text.setSelectionRange(0, 2);
    await user.click(screen.getByRole('button', { name: '插入變數 價格' }));
    expect(text.value).toBe('[價格] + 2');
    expect(text.selectionStart).toBe(4);
    await user.click(screen.getByRole('button', { name: '插入 ×' }));
    expect(text.value).toBe('[價格]× + 2');
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(text, { target: { value: '[價格] * 2' } });
    await user.click(screen.getByRole('button', { name: '關閉' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ formula: { version: 1, expression: '[價格] * 2', variables: { 價格: { columnId: 'price' } } } }));
  });

  it('reports invalid syntax live and on close without saving, then accepts a corrected formula', async () => {
    const table = fixture(), onSave = vi.fn();
    render(<ColumnConfig column={table.columns[2]} sourceColumns={table.columns} previewRow={table.rows[0]} onSave={onSave} />);
    const text = screen.getByRole('textbox', { name: '計算公式' });
    fireEvent.change(text, { target: { value: '[未知] + 1' } });
    expect(text).toHaveAttribute('aria-invalid', 'true');
    const describedBy = text.getAttribute('aria-describedby')!.split(' ');
    expect(describedBy.some(id => document.getElementById(id)?.textContent?.includes('未定義變數'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('未定義變數'));
    expect(onSave).not.toHaveBeenCalled();
    expect(table.columns[2].formula?.expression).toBe('[價格] ÷ [次數]');
    fireEvent.change(text, { target: { value: '[價格] + 1' } });
    await waitFor(() => expect(text).toHaveAttribute('aria-invalid', 'false'));
    expect(text).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('status')).toHaveTextContent('預覽（甲）：1201');
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ formula: expect.objectContaining({ expression: '[價格] + 1' }) })));
  });

  it('immediately warns when a source type change would invalidate another formula and clears on correction', () => {
    const table = fixture(), onSave = vi.fn();
    render(<ColumnConfig column={table.columns[0]} sourceColumns={table.columns} onSave={onSave} />);
    fireEvent.change(screen.getByRole('combobox', { name: '輸入類型' }), { target: { value: 'text' } });
    expect(screen.getByRole('status')).toHaveTextContent('公式只能引用其他原始數字屬性');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: '輸入類型' }), { target: { value: 'number' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('styles a runtime preview error while keeping the formula definition valid', () => {
    const table = fixture();
    render(<ColumnConfig column={table.columns[2]} sourceColumns={table.columns} previewRow={table.rows[2]} onSave={vi.fn()} />);

    const preview = screen.getByRole('status');
    expect(preview).toHaveClass('form-error');
    expect(preview).toHaveTextContent('來源值不是有效數字');
    expect(screen.getByRole('textbox', { name: '計算公式' })).toHaveAttribute('aria-invalid', 'false');
  });

  it('changes a formula without touching rows, while a saved conversion preserves results and supports undo', () => {
    const source = fixture(); source.rows = source.rows.slice(0, 2);
    const original = source.columns[2];
    const replaced = prepareWorkspaceColumnSave(source, { ...original, formula: formula('[價格] * 2') });
    expect(replaced.table.rows).toBe(source.rows);
    expect(replaced.changes).toEqual([]);
    const fixed = prepareWorkspaceColumnSave(source, { ...original, formula: undefined });
    expect(fixed.table.rows.map(row => row.values.average)).toEqual([200, 100]);
    expect(source.rows.every(row => !Object.hasOwn(row.values, 'average'))).toBe(true);
    const action = { type: 'update-column' as const, before: original, after: fixed.table.columns[2], changes: fixed.changes };
    const undone = applyWorkspaceTableHistoryAction(asData(fixed.table), source.id, action, 'undo').tables[0];
    expect(undone.columns[2].formula).toEqual(original.formula);
    expect(createWorkspaceValueReader().read(undone.rows[0], undone.columns[2]).value).toBe(200);
    const automatic = prepareWorkspaceColumnSave(fixed.table, original);
    expect(automatic.table.rows.every(row => !Object.hasOwn(row.values, 'average'))).toBe(true);
    expect(fixed.table.rows[0].values.average).toBe(200);
  });

  it('rejects invalid source definitions and refuses to turn calculation errors into fixed values', () => {
    const table = fixture();
    expect(() => prepareWorkspaceColumnSave(table, { ...table.columns[0], inputType: 'text' })).toThrow('原始數字屬性');
    expect(() => prepareWorkspaceColumnSave(table, { ...table.columns[2], formula: undefined })).toThrow('無法計算');
    expect(() => validateWorkspaceFormulaColumns([{ ...table.columns[2], formula: { ...formula(), variables: { 價格: { columnId: 'average' }, 次數: { columnId: 'count' } } } }, table.columns[1]])).toThrow();
    expect(normalizeWorkspaceFormula(formula('[價格]')).variables).toEqual({ 價格: { columnId: 'price' } });
  });
});

describe('effective values and interchange', () => {
  it('searches, sorts, filters and aggregates calculated values, with errors after valid numbers', async () => {
    const table = fixture(), rowHeader = getRowHeaderColumn(table), reader = createWorkspaceValueReader();
    table.columns[2] = { ...table.columns[2], formula: formula('[價格] ÷ [次數] + 1') };
    const { result } = renderHook(() => useWorkspaceFilter({ table, rowHeader, readCell: reader.read }));
    await waitFor(() => expect(result.current.viewStateReady).toBe(true));
    act(() => result.current.setHeaderFilters({ 'column:average': { includedKeys: null, sort: 'desc' } }));
    expect(result.current.filteredRows.map(row => row.id)).toEqual(['first', 'second', 'error']);
    act(() => result.current.setFilterTarget({ axis: 'column', id: 'average', label: '平均' }));
    expect(result.current.activeNumericValues).toEqual([201, 101]);
    expect(result.current.activeFilterOptions.map(option => option.label)).toContain('無法計算：來源值不是有效數字');
    act(() => result.current.setHeaderFilters({ 'column:average': { includedKeys: null, sort: null, min: '150' } }));
    expect(result.current.filteredRows.map(row => row.id)).toEqual(['first']);
    act(() => { result.current.clearFilters(); result.current.setSearchQuery('201'); });
    await waitFor(() => expect(result.current.searchedRows.map(row => row.id)).toEqual(['first']));
  });

  it('exports results and formula metadata, ignores exported result cells, remaps IDs and retains source bindings after rename', async () => {
    const table = fixture(); table.columns[0] = { ...table.columns[0], name: '售價' };
    const rows = tableDataRows(table);
    expect(rows[1]).toEqual(['甲', 1200, 6, 200]);
    expect(tableSettingsRows(table, '資料')[0][1]).toBe(2);
    const workbook = exportWorkspaceXlsx(asData(table), table);
    const sheets = await readStoredXlsx(workbook);
    expect(sheets.some(sheet => sheet.data[0]?.[0] === '__workspace_table_settings' && sheet.data[0]?.[1] === 2)).toBe(true);
    for (const preserveIds of [true, false]) {
      const imported = (await importWorkspaceXlsx(workbook, { preserveIds })).table!;
      const calculated = imported.columns[2];
      expect(calculated.formula?.variables['價格'].columnId).toBe(imported.columns[0].id);
      expect(imported.rows.every(row => !Object.hasOwn(row.values, calculated.id))).toBe(true);
      expect(createWorkspaceValueReader().read(imported.rows[0], calculated).value).toBe(200);
    }
    const normalized = normalizeWorkspace(asData({ ...table, rows: [{ ...table.rows[0], values: { ...table.rows[0].values, average: 999 } }] })).tables[0];
    expect(normalized.rows[0].values.average).toBeUndefined();
    const ordinary = { ...table, columns: table.columns.map(column => ({ ...column, formula: undefined })) };
    expect(tableSettingsRows(ordinary, '資料')[0][1]).toBe(1);
  });

  it('preserves rounded effective values and precision metadata through XLSX and Workspace archive transport', async () => {
    const table = fixture();
    table.columns[2] = { ...table.columns[2], formula: roundedFormula() };
    table.rows = [
      { ...table.rows[0], values: { price: 1, count: 8 } },
      { ...table.rows[1], values: { price: 9.995, count: 1 } },
    ];
    expect(tableDataRows(table)[1]).toEqual(['甲', 1, 8, 0.13]);
    const workbook = exportWorkspaceXlsx(asData(table), table);

    for (const preserveIds of [true, false]) {
      const imported = (await importWorkspaceXlsx(workbook, { preserveIds })).table!;
      const calculated = imported.columns[2];
      expect(calculated.formula?.decimalPlaces).toBe(2);
      expect(calculated.formula?.variables['價格'].columnId).toBe(imported.columns[0].id);
      expect(imported.rows.every(row => !Object.hasOwn(row.values, calculated.id))).toBe(true);
      expect(createWorkspaceValueReader().read(imported.rows[0], calculated).value).toBe(0.13);
      expect(createWorkspaceValueReader().read(imported.rows[1], calculated).value).toBe(10);
    }

    const archived = await importWorkspaceArchive(await exportWorkspaceArchive(asData(table)));
    const restored = archived.data!.tables[0];
    const restoredFormula = restored.columns[2].formula!;
    expect(restoredFormula.decimalPlaces).toBe(2);
    expect(restoredFormula.variables['價格'].columnId).toBe(restored.columns[0].id);
    expect(createWorkspaceValueReader().read(restored.rows[0], restored.columns[2]).value).toBe(0.13);
  });

  it('freezes the rounded effective value when converting a formula to a stored number', () => {
    const table = fixture();
    table.columns[2] = { ...table.columns[2], formula: roundedFormula() };
    table.rows = [{ ...table.rows[0], values: { price: 1, count: 8 } }];
    const sourceSnapshot = table.rows.map(row => ({ ...row.values }));

    const converted = prepareWorkspaceColumnSave(table, { ...table.columns[2], formula: undefined });

    expect(converted.table.columns[2].formula).toBeUndefined();
    expect(converted.table.rows[0].values.average).toBe(0.13);
    expect(converted.table.rows[0].values.price).toBe(1);
    expect(converted.table.rows[0].values.count).toBe(8);
    expect(table.rows.map(row => ({ ...row.values }))).toEqual(sourceSnapshot);
    expect(table.rows[0].values.average).toBeUndefined();
  });

  it('rejects a whole paste crossing a formula column without adding rows or changing sources', () => {
    const table = fixture();
    const paste = applyWorkspaceMatrixPaste(table, 'first', 'count', [['10', '500'], ['20', '600']]);
    expect(paste.table).toBe(table);
    expect(paste.changes).toEqual([]);
    expect(paste.invalidCells[0].reason).toContain('自動計算');
  });

  it('keeps formula definitions and effective values through a full Workspace archive', async () => {
    const table = fixture();
    const imported = await importWorkspaceArchive(await exportWorkspaceArchive(asData(table)));
    const restored = imported.data!.tables[0];
    expect(restored.id).toBe(table.id);
    expect(restored.columns[2].formula).toEqual(table.columns[2].formula);
    expect(restored.rows.every(row => !Object.hasOwn(row.values, 'average'))).toBe(true);
    expect(createWorkspaceValueReader().read(restored.rows[0], restored.columns[2]).value).toBe(200);
  });

  it('recalculates only one dependent result after a source edit in 10k cached rows', () => {
    const table = fixture(), evaluate = vi.fn(evaluateWorkspaceFormula), reader = createWorkspaceValueReader(evaluate);
    const rows = Array.from({ length: 10_000 }, (_, index) => ({ id: `large-${index}`, name: '項目', values: { price: index * 2, count: 2 } }));
    for (const row of rows) reader.read(row, table.columns[2]);
    evaluate.mockClear();
    rows[1234] = { ...rows[1234], values: { ...rows[1234].values, price: 10 } };
    for (const row of rows) reader.read(row, table.columns[2]);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(reader.read(rows[1234], table.columns[2]).value).toBe(5);
  });
});
