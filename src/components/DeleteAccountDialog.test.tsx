import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DeleteAccountDialog } from './DeleteAccountDialog';

const summary = { deletableRuleCount: 3, retainedRuleCount: 2, isLastAdmin: false };

const renderDialog = (props: Partial<React.ComponentProps<typeof DeleteAccountDialog>> = {}) => render(
  <MemoryRouter><DeleteAccountDialog
    open
    summary={summary}
    loading={false}
    busy={false}
    onCancel={vi.fn()}
    onConfirm={vi.fn()}
    {...props}
  /></MemoryRouter>,
);

afterEach(cleanup);

describe('DeleteAccountDialog', () => {
  test('explains retained rules and requires the exact confirmation phrase', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });

    expect(screen.getByText(/只會去除帳號記錄/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看詳細的資料保留方式' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByText(/另有 2 條規則曾由其他人修改/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: '永久刪除帳號' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/請輸入/), '刪除帳號');
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  test('passes the optional safe-rule deletion choice', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });

    await user.click(screen.getByRole('checkbox', { name: /也刪除由我建立且未經過他人修改/ }));
    await user.type(screen.getByLabelText(/請輸入/), '刪除帳號');
    await user.click(screen.getByRole('button', { name: '永久刪除帳號' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  test('blocks deletion of the last administrator', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog({ summary: { ...summary, isLastAdmin: true }, onConfirm });

    expect(screen.getByRole('alert')).toHaveTextContent('最後一個管理員帳號');
    expect(screen.getByLabelText(/請輸入/)).toBeDisabled();
    expect(screen.getByRole('button', { name: '永久刪除帳號' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '永久刪除帳號' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
