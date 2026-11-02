import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import { TextInputDialog } from './TextInputDialog';

// Focus must land in the same commit that opens the dialog (no timer), and a parent re-render
// with fresh callbacks must not bounce focus back to the opener while the visitor is typing.
afterEach(cleanup);

describe('dialog focus', () => {
  test('text input dialog focuses at once and keeps focus across parent re-renders', async () => {
    const user = userEvent.setup();
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    const view = render(<TextInputDialog open title="新增" label="名稱" value="" onChange={vi.fn()} onSubmit={vi.fn()} onCancel={() => undefined} />);
    const input = screen.getByLabelText('名稱');
    expect(input).toHaveFocus();
    view.rerender(<TextInputDialog open title="新增" label="名稱" value="a" onChange={vi.fn()} onSubmit={vi.fn()} onCancel={() => undefined} />);
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    view.rerender(<TextInputDialog open={false} title="新增" label="名稱" value="" onChange={vi.fn()} onSubmit={vi.fn()} onCancel={() => undefined} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  test('confirm dialog keeps focus on its own button when the parent re-renders', () => {
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    const props = { open: true, title: '刪除？', message: '無法復原', tone: 'danger' as const, onConfirm: vi.fn() };
    const view = render(<ConfirmDialog {...props} onCancel={() => undefined} />);
    const cancel = screen.getByRole('button', { name: '取消' });
    expect(cancel).toHaveFocus();
    view.rerender(<ConfirmDialog {...props} onCancel={() => undefined} />);
    expect(cancel).toHaveFocus();
    opener.remove();
  });

  test('delete account dialog keeps typed text and focus while its summary loads', async () => {
    const user = userEvent.setup();
    const dialog = (props: Partial<React.ComponentProps<typeof DeleteAccountDialog>>) => <MemoryRouter><DeleteAccountDialog
      open loading busy={false} onCancel={() => undefined} onConfirm={vi.fn()} {...props} /></MemoryRouter>;
    const view = render(dialog({}));
    const input = screen.getByLabelText(/請輸入/);
    expect(input).toHaveFocus();
    await user.keyboard('刪除');
    view.rerender(dialog({ loading: false, summary: { deletableRuleCount: 1, retainedRuleCount: 0, isLastAdmin: false } }));
    expect(input).toHaveFocus();
    await user.keyboard('帳號');
    expect(input).toHaveValue('刪除帳號');
  });
});
