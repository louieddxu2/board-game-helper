import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceBulkMultiSelectDialog } from './workspaceBulkEdit';

afterEach(() => cleanup());

describe('WorkspaceBulkMultiSelectDialog', () => {
  const column = {
    id: 'type',
    name: '類型',
    inputType: 'select' as const,
    options: ['合作', '卡牌', '家庭'],
    isMultiple: true,
  };
  const rows = [
    { rowId: 'a', value: '合作, 卡牌' },
    { rowId: 'b', value: '合作' },
    { rowId: 'c', value: '合作' },
  ];

  const optionRow = (option: string) => screen.getByRole('button', { name: new RegExp(`寫入 ${option}|取消寫入 ${option}`) }).closest('.workspace-bulk-multi-row') as HTMLElement;

  it('only frames actions that change the original aggregate count', async () => {
    const user = userEvent.setup();
    render(<WorkspaceBulkMultiSelectDialog column={column} rows={rows} options={column.options} onClose={vi.fn()} onConfirm={vi.fn()} />);

    const fullOption = screen.getByRole('button', { name: '寫入 合作 至全部格子' });
    await user.click(fullOption);
    expect(optionRow('合作')).not.toHaveClass('is-add');
    expect(optionRow('合作')).toHaveTextContent('3/3');

    await user.click(screen.getByRole('button', { name: '從全部格子移除 家庭' }));
    expect(optionRow('家庭')).not.toHaveClass('is-remove');
    expect(optionRow('家庭')).toHaveTextContent('0/3');

    await user.click(screen.getByRole('button', { name: '寫入 卡牌 至全部格子' }));
    expect(optionRow('卡牌')).toHaveClass('is-add');
    expect(optionRow('卡牌')).toHaveTextContent('3/3');

    await user.click(screen.getByRole('button', { name: '取消寫入 卡牌' }));
    expect(optionRow('卡牌')).not.toHaveClass('is-add');
    expect(optionRow('卡牌')).toHaveTextContent('1/3');

    await user.click(screen.getByRole('button', { name: '從全部格子移除 卡牌' }));
    expect(optionRow('卡牌')).toHaveClass('is-remove');
    expect(optionRow('卡牌')).toHaveTextContent('0/3');
  });

  it('marks only options with values when all remove is selected', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<WorkspaceBulkMultiSelectDialog column={column} rows={rows} options={column.options} onClose={vi.fn()} onConfirm={onConfirm} />);

    const allRemove = screen.getByRole('button', { name: '全部移除' });
    await user.click(allRemove);
    expect(optionRow('合作')).toHaveClass('is-remove');
    expect(optionRow('卡牌')).toHaveClass('is-remove');
    expect(optionRow('家庭')).not.toHaveClass('is-remove');
    expect(within(optionRow('合作')).getByText('0')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '確認' }));
    expect(onConfirm).toHaveBeenCalledWith([
      { option: '合作', action: 'remove' },
      { option: '卡牌', action: 'remove' },
    ]);
  });
});
