// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AddPage } from './AddPage';

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(public code: string, public status: number) { super(code); }
  }
  return {
    ApiError,
    useSession: vi.fn(),
    showToast: vi.fn(),
    contributions: vi.fn(),
    getDraft: vi.fn(),
    recentGames: vi.fn(),
    saveDraft: vi.fn(),
    game: vi.fn(),
    confirm: vi.fn(),
  };
});

vi.mock('../context/SessionContext', () => ({ useSession: mocks.useSession }));
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../components/GameSearch', () => ({
  clearSearchCache: vi.fn(),
  GameSearch: ({ onSelect }: { onSelect(game: { id: string; slug: string; displayName: string; ruleCount: number; updatedAt: number }): void }) => <button type="button" onClick={() => onSelect({ id: 'game-1', slug: 'known-game', displayName: '既有遊戲', ruleCount: 0, updatedAt: 1 })}>選擇既有遊戲</button>,
}));
vi.mock('../components/EditionInput', () => ({ EditionInput: () => null }));
vi.mock('../components/PlayerCountInput', () => ({ PlayerCountInput: () => null }));
vi.mock('../components/TagInput', () => ({ TagInput: () => null }));
vi.mock('../components/RuleCategoryInput', () => ({ RuleCategoryInput: () => null }));
vi.mock('../lib/api', () => ({
  ApiError: mocks.ApiError,
  api: { contributions: mocks.contributions, game: mocks.game },
}));
vi.mock('../lib/localDb', () => ({
  localDb: {
    getDraft: mocks.getDraft, recentGames: mocks.recentGames, saveDraft: mocks.saveDraft,
    addPending: vi.fn(), removePending: vi.fn(), clearDraft: vi.fn(), invalidateHome: vi.fn(), invalidateGame: vi.fn(),
  },
}));

describe('AddPage contribution constraints', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDraft.mockResolvedValue(undefined);
    mocks.recentGames.mockResolvedValue([]);
    mocks.saveDraft.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(true);
    mocks.game.mockResolvedValue({ game: { id: 'game-1', slug: 'known-game', displayName: '既有遊戲', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 } });
  });

  test('shows only a login CTA for visitors who are not signed in', () => {
    mocks.useSession.mockReturnValue({ user: null, canEdit: false, isAdmin: false, loading: false });
    render(<MemoryRouter><AddPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '登入' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('heading', { name: '使用Google帳戶登入後即可填寫' })).toBeInTheDocument();
    expect(screen.getByText('登入後可有限度地建立規則。')).toBeInTheDocument();
    expect(screen.queryByText('新增一條規則')).not.toBeInTheDocument();
  });

  test('blocks rule entry until a user without game quota selects an existing game', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'user-1', roles: [] }, canEdit: false, isAdmin: false, loading: false });
    mocks.contributions.mockResolvedValue({ quota: { pendingRules: 3, ruleLimit: 6, remainingRules: 3, pendingGames: 1, gameLimit: 1, remainingGames: 0 }, rules: [], games: [] });
    render(<MemoryRouter><AddPage /></MemoryRouter>);

    const quota = await screen.findByLabelText('投稿額度');
    expect(screen.getByRole('link', { name: '投稿說明' })).toHaveAttribute('href', '/contributions');
    expect(screen.getByRole('heading', { name: '記錄玩錯的規則' }).parentElement).toContainElement(quota);
    expect(screen.getByText('未審核規則 3 / 6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /請先選擇一款既有遊戲/ }));
    expect(mocks.showToast).toHaveBeenCalledWith('你目前無法建立新遊戲，請先選擇一款既有遊戲。詳情請查看右上方的投稿說明。', 'info');
    fireEvent.click(screen.getByRole('button', { name: '選擇既有遊戲' }));
    await waitFor(() => expect(screen.getByLabelText('正確規則 *')).toBeInTheDocument());
  });

  test('does not show contribution guidance or quota to editors', () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    render(<MemoryRouter><AddPage /></MemoryRouter>);

    expect(screen.queryByRole('link', { name: '投稿說明' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('投稿額度')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '隱私與資料說明' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByLabelText('玩錯情況')).toBeInTheDocument();
    expect(mocks.contributions).not.toHaveBeenCalled();
  });

  test('keeps the add button clickable but refuses rows beyond the remaining rule quota', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'user-1', roles: [] }, canEdit: false, isAdmin: false, loading: false });
    mocks.contributions.mockResolvedValue({ quota: { pendingRules: 4, ruleLimit: 6, remainingRules: 2, pendingGames: 0, gameLimit: 1, remainingGames: 1 }, rules: [], games: [] });
    const { container } = render(<MemoryRouter><AddPage /></MemoryRouter>);

    await screen.findByText('未審核規則 4 / 6');
    fireEvent.click(screen.getByRole('button', { name: '＋新增一條規則' }));
    expect(container.querySelectorAll('.rule-input')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '＋新增一條規則' }));
    expect(container.querySelectorAll('.rule-input')).toHaveLength(2);
    expect(mocks.showToast).toHaveBeenCalledWith('已達本次可新增上限，請查看右上方的投稿說明。', 'info');
  });
});
