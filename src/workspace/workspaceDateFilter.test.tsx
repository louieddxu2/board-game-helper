import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTimeWheelEditor, HeaderFilterDialog } from './workspaceDialogs';
import { dateFilterBoundary } from './dateFilter';
import type { HeaderFilterState } from './workspaceShared';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderDateFilter = (state: HeaderFilterState) => {
  const onDateRange = vi.fn();
  const onClearDate = vi.fn();
  render(<HeaderFilterDialog label="日期" inputType="datetime" options={[]} numericValues={[]} state={state} onClose={() => undefined} onSort={() => undefined} onToggle={() => undefined} onSelectAll={() => undefined} onClearAll={() => undefined} onQuery={() => undefined} onRange={() => undefined} onDateRange={onDateRange} onClearDate={onClearDate} onAggregate={() => undefined} />);
  return { onDateRange, onClearDate };
};

describe('workspace date range filter', () => {
  it('starts at day precision and shows today as the initial end date', () => {
    const today = new Date();
    renderDateFilter({ includedKeys: null, sort: null });
    const end = screen.getByRole('group', { name: '結束日期' });

    expect(screen.getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(end).getByRole('listbox', { name: '年' }).querySelector('button.selected')).toHaveTextContent(String(today.getFullYear()));
    expect(within(end).getByRole('listbox', { name: '月' }).querySelector('button.selected')).toHaveTextContent(String(today.getMonth() + 1));
    expect(within(end).getByRole('listbox', { name: '日' }).querySelector('button.selected')).toHaveTextContent(String(today.getDate()));
  });

  it('extends a month range through its final day, including leap February', () => {
    expect(dateFilterBoundary({ year: 2024, month: 2, day: 12 }, 'month', true)).toBe('2024-02-29');
    expect(dateFilterBoundary({ year: 2025, month: 2, day: 12 }, 'month', true)).toBe('2025-02-28');
  });

  it('keeps two three-column wheels in place while changing date precision', () => {
    const { onDateRange } = renderDateFilter({ includedKeys: null, sort: null, min: '2024-03-12', max: '2024-08-25', datePrecision: 'day' });
    const start = screen.getByRole('group', { name: '開始日期' });
    const end = screen.getByRole('group', { name: '結束日期' });
    expect(within(start).queryAllByText('－')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '月' }));
    expect(within(start).getByRole('group', { name: '日未啟用' })).toHaveTextContent('－');
    expect(within(end).getByRole('group', { name: '日未啟用' })).toHaveTextContent('－');
    fireEvent.click(screen.getByRole('button', { name: '套用範圍' }));
    expect(onDateRange).toHaveBeenLastCalledWith('2024-03-01', '2024-08-31', 'month');

    fireEvent.click(screen.getByRole('button', { name: '年' }));
    expect(within(start).getByRole('group', { name: '月未啟用' })).toHaveTextContent('－');
    expect(within(end).getByRole('group', { name: '日未啟用' })).toHaveTextContent('－');
    fireEvent.click(screen.getByRole('button', { name: '套用範圍' }));
    expect(onDateRange).toHaveBeenLastCalledWith('2024-01-01', '2024-12-31', 'year');
  });

  it('replaces a saved month selection with a range and never opens a native date input', () => {
    const { onDateRange, onClearDate } = renderDateFilter({ includedKeys: ['date-month:2024-03'], sort: null });
    expect(screen.getByText(/先前選取的年月仍在篩選中/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('2024-03')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '套用範圍' }));
    expect(onDateRange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.any(String), 'day');
    fireEvent.click(screen.getByRole('button', { name: '清除範圍' }));
    expect(onClearDate).toHaveBeenCalledTimes(1);
  });

  it('accepts a direct year entry and prevents a reversed range', () => {
    const { onDateRange } = renderDateFilter({ includedKeys: null, sort: null, min: '2024-01-01', max: '2024-12-31', datePrecision: 'year' });
    const start = screen.getByRole('group', { name: '開始日期' });
    fireEvent.click(within(start).getByRole('listbox', { name: '年' }).querySelector('button.selected')!);
    const yearInput = screen.getByRole('spinbutton', { name: '輸入開始年份' });
    fireEvent.change(yearInput, { target: { value: '2025' } });
    fireEvent.keyDown(yearInput, { key: 'Enter' });

    expect(screen.getByRole('alert')).toHaveTextContent('結束日期須晚於開始日期');
    expect(screen.getByRole('button', { name: '套用範圍' })).toBeDisabled();
    expect(onDateRange).not.toHaveBeenCalled();
  });

  it('preserves an open-ended date range', () => {
    const { onDateRange } = renderDateFilter({ includedKeys: null, sort: null, min: '2024-03-01', max: '', datePrecision: 'month' });
    const end = screen.getByRole('group', { name: '結束日期' });
    expect(within(end).getByRole('button', { name: '年未設定，滑動以設定' })).toHaveTextContent('－');
    expect(screen.queryByRole('button', { name: '設定結束日期' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '套用範圍' }));
    expect(onDateRange).toHaveBeenCalledWith('2024-03-01', '', 'month');
  });

  it.each([
    { precision: 'year' as const, label: '年' },
    { precision: 'month' as const, label: '月' },
    { precision: 'day' as const, label: '日' },
  ])('activates an open end by swiping its $label dash', ({ precision, label }) => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const { onDateRange } = renderDateFilter({ includedKeys: null, sort: null, min: '2024-01-01', max: '', datePrecision: precision });
    const end = screen.getByRole('group', { name: '結束日期' });
    const wheel = within(end).getByRole('button', { name: `${label}未設定，滑動以設定` });
    fireEvent.pointerDown(wheel, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(wheel, { pointerId: 1, clientY: 84 });
    fireEvent.pointerUp(wheel, { pointerId: 1, clientY: 84 });

    expect(within(end).getByRole('listbox', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '不設結束日期' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '套用範圍' }));
    expect(onDateRange).toHaveBeenCalledWith('2024-01-01', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), precision);
  });

  it('does not activate a month dash excluded by year precision', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    renderDateFilter({ includedKeys: null, sort: null, min: '2024-01-01', max: '', datePrecision: 'year' });
    const end = screen.getByRole('group', { name: '結束日期' });
    const month = within(end).getByRole('group', { name: '月未啟用' });
    fireEvent.pointerDown(month, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(month, { pointerId: 1, clientY: 70 });
    fireEvent.pointerUp(month, { pointerId: 1, clientY: 70 });
    expect(within(end).getByRole('button', { name: '年未設定，滑動以設定' })).toBeInTheDocument();
  });
});

describe('workspace date wheel feedback', () => {
  it('moves the option track with a drag and snaps to the next value', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const Editor = () => {
      const [value, setValue] = useState('2024-03-12T00:00:00.000Z');
      return <DateTimeWheelEditor value={value} ariaLabel="日期" showTime={false} onChange={setValue} />;
    };
    render(<Editor />);
    const monthWheel = screen.getByRole('listbox', { name: '月' });
    fireEvent.pointerDown(monthWheel, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(monthWheel, { pointerId: 1, clientY: 84 });
    expect(monthWheel.querySelector('.workspace-datetime-wheel-track')).toHaveStyle('--workspace-wheel-offset: -16px');
    fireEvent.pointerMove(monthWheel, { pointerId: 1, clientY: 64 });
    expect(within(monthWheel).getByRole('option', { selected: true })).toHaveTextContent('4');
    fireEvent.pointerUp(monthWheel, { pointerId: 1, clientY: 64 });
    expect(monthWheel.querySelector('.workspace-datetime-wheel-track')).toHaveStyle('--workspace-wheel-offset: 0px');
  });
});
