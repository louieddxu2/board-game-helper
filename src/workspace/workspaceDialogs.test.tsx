import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createColumn } from './model';
import { CellInputDialog, ColumnConfig } from './workspaceDialogs';

afterEach(() => cleanup());

describe('workspace numeric input modes', () => {
  it('saves the selected numeric input mode from column settings', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ColumnConfig column={{ ...createColumn('數量', 'number'), numberInputMode: 'input' }} onSave={onSave} />);

    expect(screen.getByRole('button', { name: '輸入' })).toHaveClass('selected');
    await user.click(screen.getByRole('button', { name: '加減1' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'number', numberInputMode: 'step' }));
  });

  it('changes a value by one without closing the stepper dialog', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const column = { ...createColumn('數量', 'number'), numberInputMode: 'step' as const };
    render(<CellInputDialog column={column} value={2} onSave={onSave} />);

    const input = screen.getByRole('spinbutton', { name: '數量輸入' });
    await user.click(screen.getByRole('button', { name: '增加 1' }));
    expect(input).toHaveValue(3);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '減少 1' }));
    expect(input).toHaveValue(2);

    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(onSave).toHaveBeenCalledWith('2');
  });

  it('keeps the input mode as a plain numeric editor', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const column = { ...createColumn('數量', 'number'), numberInputMode: 'input' as const };
    render(<CellInputDialog column={column} value={2} onSave={onSave} />);

    expect(screen.queryByRole('button', { name: '增加數值' })).not.toBeInTheDocument();
    const input = screen.getByRole('spinbutton', { name: '數量輸入' });
    await user.clear(input);
    await user.type(input, '7');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(onSave).toHaveBeenCalledWith('7');
  });
});
