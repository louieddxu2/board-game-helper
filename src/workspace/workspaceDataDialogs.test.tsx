import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTable, emptyWorkspace, ensureTableDynamicOptions } from './model';
import { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import { assignWorkspaceChangeRevisions } from './changeRevisions';
import { WorkspacePasteDialog, WorkspaceTableImportPreviewDialog } from './workspaceDataDialogs';

afterEach(cleanup);

describe('workspace data dialogs', () => {
  it('previews a pasted rectangle before applying it', async () => {
    const onApply = vi.fn();
    render(<WorkspacePasteDialog targetLabel="花火／名稱" onClose={() => undefined} onApply={onApply} />);
    fireEvent.change(screen.getByRole('textbox', { name: '貼上試算表內容' }), { target: { value: '甲\t1\n乙\t2' } });
    await userEvent.click(screen.getByRole('button', { name: '貼上 2 × 2' }));
    expect(onApply).toHaveBeenCalledWith([['甲', '1'], ['乙', '2']]);
  });

  it('shows inferred columns and lets the user override a type before import', async () => {
    const table = createTable('匯入表');
    table.columns[0].name = '數量';
    table.rows[0].values[table.columns[0].id] = '12';
    const onImport = vi.fn();
    render(<WorkspaceTableImportPreviewDialog table={table} source="plain" onClose={() => undefined} onImport={onImport} />);
    expect(screen.getByText('一般試算表（已自動判斷欄位型態）')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '數量型態' }), 'number');
    await userEvent.click(screen.getByRole('button', { name: '匯入表格' }));
    expect(onImport.mock.calls[0][0].columns[0].inputType).toBe('number');
    expect(onImport.mock.calls[0][0].rows[0].values[table.columns[0].id]).toBe(12);
  });

  it('keeps original values and dynamic statistics when preview type changes are toggled back', async () => {
    const table = createTable('匯入表');
    table.columns[0] = { ...table.columns[0], name: '數量', inputType: 'dynamic-select' };
    const columnId = table.columns[0].id;
    table.rows[0].values[columnId] = '0012';
    const saved = ensureTableDynamicOptions(table);
    const onImport = vi.fn();
    render(<WorkspaceTableImportPreviewDialog table={saved} source="structured" onClose={() => undefined} onImport={onImport} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '數量型態' }), 'number');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '數量型態' }), 'dynamic-select');
    await userEvent.click(screen.getByRole('button', { name: '匯入表格' }));
    const imported = onImport.mock.calls[0][0];
    expect(imported.columns[0].dynamicOptions).toEqual(saved.columns[0].dynamicOptions);
    expect(imported.rows[0].values[columnId]).toBe('0012');
    const next = { ...emptyWorkspace(), tables: [imported] };
    const cache = new WorkspaceDynamicOptionsCache();
    cache.primeImportedTables(next, [imported.id]);
    const committed = cache.prepare(undefined, assignWorkspaceChangeRevisions(undefined, next));
    expect(cache.getOptions(committed.tables[0], columnId)).toEqual(['0012']);
    expect(committed.tables[0].columns[0].dynamicOptions?.counts[0].key).toBe('0012');
  });
});
