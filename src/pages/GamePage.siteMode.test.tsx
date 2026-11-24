import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { writeSiteMode } from '../lib/siteMode';
import { uiHistory } from '../workspace/uiHistory';
import { GamePage } from './GamePage';

const mocks = vi.hoisted(() => ({ isAdmin: true, listUncertain: vi.fn() }));
vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: { id: 'admin-1', roles: ['admin'] }, canEdit: true, isAdmin: mocks.isAdmin }),
}));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  supersedeGameRefreshes: vi.fn(),
  api: {
    game: vi.fn(async () => ({ game })),
    tags: vi.fn(async () => ({ tags: [] })),
    favoriteStatus: vi.fn(async () => ({ favorite: false, favoriteCount: 0 })),
    markFavoriteSeen: vi.fn(async () => ({ ok: true })),
    recordView: vi.fn(async () => ({ ok: true })),
    ruleImportance: vi.fn(async () => ({ ruleIds: [] })),
  },
}));
vi.mock('../lib/uncertainRulesApi', () => ({ uncertainRulesApi: { list: mocks.listUncertain } }));
vi.mock('../lib/localDb', () => ({ localDb: { invalidateGame: vi.fn() } }));
vi.mock('../lib/tagHydration', () => ({ hydrateGameTags: async (value: unknown) => value, hydrateRuleTags: async (rules: unknown) => rules }));
vi.mock('../components/FavoriteLimitDialog', () => ({ FavoriteLimitDialog: () => null }));

const game = {
  id: 'game-1', slug: 'test-game', displayName: '測試遊戲', aliases: [], ruleCount: 1, updatedAt: 1, reviewStatus: 'not_required' as const,
  rules: [{ id: 'rule-1', gameId: 'game-1', statement: '正確規則', commonMistake: '玩錯情況', status: 'published' as const, tags: [], sourceLinks: [] }],
};
const renderGamePage = () => render(<MemoryRouter initialEntries={['/games/test-game']}>
  <Routes><Route path="/games/:identifier" element={<GamePage />} /></Routes>
</MemoryRouter>);

beforeEach(() => {
  uiHistory.dispose();
  mocks.isAdmin = true;
  mocks.listUncertain.mockReset().mockResolvedValue({ uncertainRules: [{ id: 'u1', gameId: 'game-1', question: '平手怎麼算？', checkedAt: null, createdAt: 1, updatedAt: 1 }] });
});
afterEach(() => { cleanup(); writeSiteMode('wrong'); uiHistory.dispose(); });

test('the uncertain mode swaps the game page from its rules to its uncertain rules', async () => {
  writeSiteMode('uncertain');
  renderGamePage();
  expect(await screen.findByText('平手怎麼算？')).toBeInTheDocument();
  expect(screen.queryByText('正確規則')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '＋記錄' })).toHaveAttribute('href', '/add?game=test-game');
  act(() => writeSiteMode('wrong'));
  expect(await screen.findByText('正確規則')).toBeInTheDocument();
  expect(screen.queryByText('平手怎麼算？')).not.toBeInTheDocument();
});

test('a non-admin sees the rules and never loads uncertain rules', async () => {
  mocks.isAdmin = false;
  writeSiteMode('uncertain');
  renderGamePage();
  expect(await screen.findByText('正確規則')).toBeInTheDocument();
  expect(mocks.listUncertain).not.toHaveBeenCalled();
});
