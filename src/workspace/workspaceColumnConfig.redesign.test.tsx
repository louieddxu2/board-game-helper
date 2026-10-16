import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createColumn } from './model';
import type { WorkspaceFormula, WorkspaceNumberRange } from './types';
import { ColumnConfig } from './workspaceColumnConfig';

const closeDialog = () => fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
const typeValues = ['text', 'number', 'dynamic-select', 'select', 'datetime', 'link'];
const formula = (expression = '2 + 3'): WorkspaceFormula => ({ version: 1, expression, variables: {} });

afterEach(() => cleanup());

describe('workspace column settings redesign', () => {
  it('uses one native type chooser and keeps type changes draft-only until close', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ColumnConfig column={createColumn('欄位')} onSave={onSave} />);

    const dialog = screen.getByRole('dialog', { name: '屬性設定' });
    const chooser = within(dialog).getByRole('combobox', { name: '輸入類型' });
    expect(Array.from(chooser.querySelectorAll('option'), option => option.value)).toEqual(typeValues);

    await user.selectOptions(chooser, 'dynamic-select');
    expect(chooser).toHaveValue('dynamic-select');
    expect(onSave).not.toHaveBeenCalled();

    closeDialog();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'dynamic-select' }));
  });

  it('combines numeric modes, reveals a two-row formula editor, and avoids implicit focus', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ColumnConfig column={createColumn('數量', 'number')} sourceColumns={[]} onSave={onSave} />);

    const dialog = screen.getByRole('dialog', { name: '屬性設定' });
    const modes = within(dialog).getByRole('group', { name: '數字輸入方式' });
    expect(within(modes).getAllByRole('button').map(button => button.textContent)).toEqual(['輸入', '加減數字', '加減1', '公式']);
    expect(within(modes).queryByRole('button', { name: '手動輸入' })).not.toBeInTheDocument();
    expect(within(modes).queryByRole('button', { name: '自動計算' })).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: '加減數字' }));
    expect(within(modes).getByRole('button', { name: '加減數字' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(modes).getByRole('button', { name: '公式' }));
    const text = within(dialog).getByRole('textbox', { name: '計算公式' });
    expect(text).toHaveAttribute('rows', '2');
    expect(text).not.toHaveFocus();

    const chooser = within(dialog).getByRole('combobox', { name: '輸入類型' });
    await user.selectOptions(chooser, 'text');
    expect(within(dialog).queryByRole('textbox', { name: '計算公式' })).not.toBeInTheDocument();
    await user.selectOptions(chooser, 'number');
    const restoredText = within(dialog).getByRole('textbox', { name: '計算公式' });
    expect(restoredText).not.toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();

    await user.click(restoredText);
    await user.type(restoredText, '2 + 3');
    closeDialog();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'number', formula: expect.objectContaining({ expression: '2 + 3' }) }));
  });

  it('retains edited ranges through collapse, type, numeric-mode, and display switches', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const ranges: WorkspaceNumberRange[] = [{ min: 1, max: 10, color: '#1D4ED8' }];
    render(<ColumnConfig column={{ ...createColumn('數量', 'number'), numberRanges: ranges }} onSave={onSave} />);

    const dialog = screen.getByRole('dialog', { name: '屬性設定' });
    const summary = within(dialog).getByRole('button', { name: /^數字範圍顏色/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    await user.click(summary);
    const minimum = within(dialog).getByRole('spinbutton', { name: '第 1 段下限' });
    await user.clear(minimum);
    await user.type(minimum, '2');
    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');

    const chooser = within(dialog).getByRole('combobox', { name: '輸入類型' });
    await user.selectOptions(chooser, 'text');
    await user.selectOptions(chooser, 'number');
    const modes = within(dialog).getByRole('group', { name: '數字輸入方式' });
    await user.click(within(modes).getByRole('button', { name: '加減1' }));
    const display = within(dialog).getByRole('button', { name: '自動換行' });
    await user.click(display);
    await user.click(display);

    const restoredSummary = within(dialog).getByRole('button', { name: /^數字範圍顏色/ });
    expect(restoredSummary).toHaveAttribute('aria-expanded', 'false');
    expect(restoredSummary).toHaveTextContent('1 段');
    await user.click(restoredSummary);
    expect(within(dialog).getByRole('spinbutton', { name: '第 1 段下限' })).toHaveValue(2);
    expect(within(dialog).getByRole('spinbutton', { name: '第 1 段上限' })).toHaveValue(10);
    expect(onSave).not.toHaveBeenCalled();

    closeDialog();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'number', numberInputMode: 'step', numberRanges: [{ min: 2, max: 10, color: '#1D4ED8' }] }));
  });

  it('retains a formula draft through manual, type, and display switches', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ColumnConfig column={{ ...createColumn('計算', 'number'), formula: formula(), numberInputMode: 'input' }} sourceColumns={[]} onSave={onSave} />);

    const dialog = screen.getByRole('dialog', { name: '屬性設定' });
    const modes = within(dialog).getByRole('group', { name: '數字輸入方式' });
    const editedFormula = within(dialog).getByRole('textbox', { name: '計算公式' });
    await user.clear(editedFormula);
    await user.type(editedFormula, '7 / 2');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: '四捨五入小數位數' }), '2');
    expect(editedFormula).toHaveValue('7 / 2');
    expect(within(dialog).getByRole('combobox', { name: '四捨五入小數位數' })).toHaveValue('2');
    await user.click(within(modes).getByRole('button', { name: '輸入' }));
    expect(within(dialog).queryByRole('textbox', { name: '計算公式' })).not.toBeInTheDocument();

    const chooser = within(dialog).getByRole('combobox', { name: '輸入類型' });
    await user.selectOptions(chooser, 'text');
    await user.selectOptions(chooser, 'number');
    const restoredModes = within(dialog).getByRole('group', { name: '數字輸入方式' });
    await user.click(within(restoredModes).getByRole('button', { name: '公式' }));
    expect(within(dialog).getByRole('textbox', { name: '計算公式' })).toHaveValue('7 / 2');

    const display = within(dialog).getByRole('button', { name: '自動換行' });
    await user.click(display);
    await user.click(display);
    expect(within(dialog).getByRole('textbox', { name: '計算公式' })).toHaveValue('7 / 2');
    expect(within(dialog).getByRole('combobox', { name: '四捨五入小數位數' })).toHaveValue('2');
    expect(onSave).not.toHaveBeenCalled();

    closeDialog();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'number', formula: expect.objectContaining({ expression: '7 / 2', decimalPlaces: 2 }) }));
  });
});
