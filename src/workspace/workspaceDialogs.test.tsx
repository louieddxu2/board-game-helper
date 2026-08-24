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
    expect(input).toHaveStyle({ textAlign: 'center' });
    expect(document.activeElement).not.toBe(input);
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

describe('workspace selection option dragging', () => {
  it('auto-scrolls a long option editor only after clear drag intent and an edge dwell', async () => {
    const column = { ...createColumn('類型', 'select'), options: Array.from({ length: 12 }, (_, index) => `選項 ${index + 1}`) };
    render(<ColumnConfig column={column} onSave={vi.fn()} />);
    const panel = document.querySelector('.workspace-column-config-panel') as HTMLDivElement;
    const handle = screen.getByRole('button', { name: '拖曳固定選項 1' });
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const previousCancelAnimationFrame = window.cancelAnimationFrame;
    let animationFrame: FrameRequestCallback | undefined;
    const dispatchPointer = (element: Element | Window, type: string, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 30, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 41 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    Object.defineProperties(panel, {
      clientHeight: { configurable: true, value: 240 },
      scrollHeight: { configurable: true, value: 900 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    panel.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 400, width: 400, height: 240, x: 0, y: 0, toJSON: () => ({}) });
    window.requestAnimationFrame = vi.fn((callback) => { animationFrame = callback; return 1; });
    window.cancelAnimationFrame = vi.fn();

    try {
      dispatchPointer(handle, 'pointerdown', 230);
      dispatchPointer(window, 'pointermove', 235);
      expect(panel.scrollTop).toBe(0);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      animationFrame?.(0);
      expect(panel.scrollTop).toBe(0);
      dispatchPointer(window, 'pointermove', 180);
      dispatchPointer(window, 'pointermove', 235);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      animationFrame?.(0);
      expect(panel.scrollTop).toBeGreaterThan(0);
    } finally {
      dispatchPointer(window, 'pointerup', 235);
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;
    }
  });
});
