// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AccountPage } from './AccountPage';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  accountCreatedRules: vi.fn(),
  accountModifiedRules: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../context/SessionContext', () => ({ useSession: mocks.useSession }));
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }));
vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error { constructor(public code: string) { super(code); } },
  api: {
    accountCreatedRules: mocks.accountCreatedRules,
    accountModifiedRules: mocks.accountModifiedRules,
    updateNickname: vi.fn(), clearFavorites: vi.fn(), accountDeletionSummary: vi.fn(), deleteAccount: vi.fn(), restoreRule: vi.fn(),
  },
}));
vi.mock('../lib/localDb', () => ({
  localDb: { invalidateHome: vi.fn(), invalidateAllGames: vi.fn(), clearCachedRuleImportance: vi.fn() },
}));

afterEach(cleanup);

describe('AccountPage lazy activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      user: { id: 'editor-1', roles: ['editor'], nickname: '東東', showNickname: true },
      realUser: { id: 'editor-1', roles: ['editor'] },
      loading: false,
      logout: vi.fn(),
      canEdit: true,
      refresh: vi.fn(),
    });
    mocks.accountCreatedRules.mockResolvedValue({
      rules: [{ id: 'rule-1', gameName: '範例遊戲', gameSlug: 'example', statement: '範例規則', status: 'published', createdAt: 1, updatedAt: 1 }],
    });
    mocks.accountModifiedRules.mockResolvedValue({ revisions: [] });
  });

  test('does not read rule history until expanded and reuses it after collapsing', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AccountPage /></MemoryRouter>);

    expect(mocks.accountCreatedRules).not.toHaveBeenCalled();
    expect(mocks.accountModifiedRules).not.toHaveBeenCalled();

    const toggle = screen.getByRole('button', { name: /我建立的規則/ });
    await user.click(toggle);
    await waitFor(() => expect(screen.getByText('範例規則')).toBeInTheDocument());
    expect(mocks.accountCreatedRules).toHaveBeenCalledOnce();
    expect(screen.getByText('收起・近期 20 筆')).toBeInTheDocument();

    await user.click(toggle);
    await user.click(toggle);
    expect(screen.getByText('範例規則')).toBeInTheDocument();
    expect(mocks.accountCreatedRules).toHaveBeenCalledOnce();
  });

  test('offers reviewed creation and modification history to a general user without restore controls', async () => {
    const user = userEvent.setup();
    mocks.useSession.mockReturnValue({
      user: { id: 'user-1', roles: [] }, realUser: { id: 'user-1', roles: [] },
      loading: false, logout: vi.fn(), canEdit: false, refresh: vi.fn(),
    });
    render(<MemoryRouter><AccountPage /></MemoryRouter>);

    expect(screen.getByText('展開後讀取已通過審核的投稿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /我的規則修改紀錄/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /我建立的規則/ }));
    await waitFor(() => expect(mocks.accountCreatedRules).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: /我的規則修改紀錄/ }));
    await waitFor(() => expect(mocks.accountModifiedRules).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: '恢復' })).not.toBeInTheDocument();
  });
});
