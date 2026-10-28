// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CatalogPage } from './CatalogPage';

const tag = { id: 'tag-1', slug: 'setup', name: '起始設置' };
const game = { id: 'game-1', slug: 'shipyard', displayName: '船廠', englishName: 'Shipyard', aliases: [], ruleCount: 1, updatedAt: 1,
  rules: [{ id: 'rule-1', statement: '原本展開的規則', tags: [tag], categories: [], status: 'published', updatedAt: 1 }] };
const mocks = vi.hoisted(() => ({ game: vi.fn(), catalogGames: vi.fn() }));
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: { id: 'admin' }, loading: false, canEdit: true, isAdmin: true }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../components/GameSearch', () => ({ clearSearchCache: vi.fn() }));
vi.mock('./GamePage', () => ({ RuleEditor: () => null }));
vi.mock('../lib/tagHydration', () => ({ hydrateGameTags: async (value: unknown) => value }));
vi.mock('../lib/api', () => ({ api: { game: mocks.game, catalogGames: mocks.catalogGames,
  editorContributions: async () => ({ games: [{ gameId: 'game-1', pendingRuleCount: 1 }], pendingGameIds: [] }),
  tags: async () => ({ tags: [tag] }),
} }));

const ReturnToCatalog = () => {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>返回列表</button>;
};
const initial = '/catalog?q=%E8%88%B9&pending=1&game=game-1&tag=%E8%B5%B7%E5%A7%8B%E8%A8%AD%E7%BD%AE';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.game.mockReset(); mocks.catalogGames.mockReset();
  mocks.game.mockResolvedValue({ game }); mocks.catalogGames.mockResolvedValue({ games: [game] });
});

test('restores the query, pending filter, expanded game and tags after returning from a game', async () => {
  render(<MemoryRouter initialEntries={[initial]}><Routes>
    <Route path="/catalog" element={<CatalogPage />} />
    <Route path="/games/:slug" element={<ReturnToCatalog />} />
  </Routes></MemoryRouter>);
  const open = await screen.findByRole('link', { name: '開啟一般遊戲頁 ↗' });
  expect(screen.getByRole('searchbox')).toHaveValue('船');
  expect(screen.getByRole('checkbox', { name: '只看待審核' })).toBeChecked();
  expect(screen.getByRole('button', { name: '#起始設置' })).toHaveClass('active');
  fireEvent.click(open);
  fireEvent.click(await screen.findByRole('button', { name: '返回列表' }));
  expect(await screen.findByRole('link', { name: '開啟一般遊戲頁 ↗' })).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('船');
  expect(screen.getByRole('checkbox', { name: '只看待審核' })).toBeChecked();
  expect(screen.getByRole('button', { name: '#起始設置' })).toHaveClass('active');
  expect(screen.getAllByText('原本展開的規則')).toHaveLength(2);
});

test('changing local filters does not reload an already expanded game', async () => {
  render(<MemoryRouter initialEntries={[initial]}><CatalogPage /></MemoryRouter>);
  await screen.findAllByText('原本展開的規則');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Shipyard' } });
  fireEvent.click(screen.getByRole('button', { name: '#起始設置' }));
  await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('Shipyard'));
  expect(mocks.game).toHaveBeenCalledTimes(1);
  expect(mocks.catalogGames).toHaveBeenCalledTimes(1);
});
