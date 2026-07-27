import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { EditionInput } from './EditionInput';

afterEach(cleanup);

describe('EditionInput', () => {
  test('selects and clears existing options with buttons', () => {
    const onChange = vi.fn();
    const view = render(<EditionInput value={[]} options={['挪威人擴充', '修訂版']} onChange={onChange} />);

    fireEvent.click(view.getByRole('button', { name: '挪威人擴充' }));
    expect(onChange).toHaveBeenCalledWith(['挪威人擴充']);

    view.rerender(<EditionInput value={['挪威人擴充', '修訂版']} options={['挪威人擴充', '修訂版']} onChange={onChange} />);
    expect(view.getByRole('button', { name: '挪威人擴充' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(view.getByRole('button', { name: '挪威人擴充' }));
    expect(onChange).toHaveBeenLastCalledWith(['修訂版']);
  });

  test('adds a new option through the internal dialog', () => {
    const ControlledInput = () => {
      const [value, setValue] = useState<string[]>([]);
      return <EditionInput value={value} options={['修訂版']} onChange={setValue} />;
    };
    render(<ControlledInput />);

    fireEvent.click(screen.getByRole('button', { name: '＋新增版本／擴充' }));
    expect(screen.getByRole('dialog', { name: '新增版本／擴充' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('版本／擴充名稱'), { target: { value: ' 挪威人擴充 ' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '挪威人擴充' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '＋新增版本／擴充' }));
    fireEvent.change(screen.getByLabelText('版本／擴充名稱'), { target: { value: '第二擴充' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    expect(screen.getByRole('button', { name: '挪威人擴充' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '第二擴充' })).toHaveAttribute('aria-pressed', 'true');
  });
});
