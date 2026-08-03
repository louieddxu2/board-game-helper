// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ContributionsPage } from './ContributionsPage';

const { useSession, contributions } = vi.hoisted(() => ({ useSession: vi.fn(), contributions: vi.fn() }));

vi.mock('../context/SessionContext', () => ({ useSession }));
vi.mock('../lib/api', () => ({ api: { contributions } }));

describe('ContributionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('gives signed-out visitors only the limited-contribution login prompt', () => {
    useSession.mockReturnValue({ user: null, loading: false, canEdit: false });
    render(<MemoryRouter><ContributionsPage /></MemoryRouter>);

    expect(screen.getByRole('link', { name: '登入' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('heading', { name: '使用Google帳戶登入後即可填寫' })).toBeInTheDocument();
    expect(screen.getByText('登入後可有限度地建立規則。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '如何申請完整的編輯/審核權限？' })).not.toBeInTheDocument();
    expect(contributions).not.toHaveBeenCalled();
  });

  test('redirects editors without loading contribution guidance', () => {
    useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, loading: false, canEdit: true });
    render(<MemoryRouter initialEntries={['/contributions']}><Routes>
      <Route path="/contributions" element={<ContributionsPage />} />
      <Route path="/add" element={<p>填寫頁</p>} />
    </Routes></MemoryRouter>);

    expect(screen.getByText('填寫頁')).toBeInTheDocument();
    expect(screen.queryByText('投稿狀態與權限')).not.toBeInTheDocument();
    expect(contributions).not.toHaveBeenCalled();
  });

  test('shows only pending submissions and omits reviewed content', async () => {
    useSession.mockReturnValue({ user: { id: 'user-1', roles: [] }, loading: false, canEdit: false });
    contributions.mockResolvedValue({
      quota: { pendingRules: 2, ruleLimit: 6, remainingRules: 4, pendingGames: 1, gameLimit: 1, remainingGames: 0 },
      rules: [
        { id: 'rule-1', gameId: 'game-1', gameName: '範例遊戲', gameSlug: 'example', statement: '待審核規則', status: 'published', reviewStatus: 'pending', createdAt: 1, updatedAt: 1 },
        { id: 'rule-2', gameId: 'game-2', gameName: '已審核遊戲', gameSlug: 'reviewed', statement: '已審核規則', status: 'published', reviewStatus: 'reviewed', createdAt: 1, updatedAt: 1 },
      ],
      games: [
        { id: 'game-1', slug: 'example', displayName: '待審核遊戲', visibility: 'public', reviewStatus: 'pending', createdAt: 1, updatedAt: 1 },
        { id: 'game-2', slug: 'reviewed', displayName: '已通過遊戲', visibility: 'public', reviewStatus: 'reviewed', reviewedByNickname: '東東', createdAt: 1, updatedAt: 1 },
      ],
    });
    render(<MemoryRouter><ContributionsPage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('未審核規則 2 / 6')).toBeInTheDocument());
    expect(screen.getByText('可再建立 0 款')).toBeInTheDocument();
    expect(screen.getAllByText('未審核')).toHaveLength(2);
    expect(screen.getByText('待審核規則')).toBeInTheDocument();
    expect(screen.queryByText('已審核規則')).not.toBeInTheDocument();
    expect(screen.queryByText('已通過遊戲')).not.toBeInTheDocument();
    expect(screen.getByText(/覺得記錄在此網頁方便自用，且分享給大家也不錯/)).toBeInTheDocument();
    expect(screen.getByText(/提供你的Gmail帳號/)).toBeInTheDocument();
    expect(screen.getByText('白話來說，讓我確定你是善意、穩定的使用者。')).toBeInTheDocument();
    expect(contributions).toHaveBeenCalledOnce();
  });
});
