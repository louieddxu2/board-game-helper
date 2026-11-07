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
vi.mock('../lib/api', () => ({ api: { game: mocks.game, catalogGames: mocks.catalogGames,
  editorContributions: async () => ({ games: [{ gameId: 'game-1', pendingRuleCount: 1 }], pendingGameIds: [] }),
  tags: async () => ({ tags: [tag] }),
} }));

const ReturnToCatalog = () => {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>返回列表</button>;
};
const initial = '/catalog?q=%E8%88%B9&pending=1&game=game-1';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.game.mockReset(); mocks.catalogGames.mockReset();
  mocks.game.mockResolvedValue({ game }); mocks.catalogGames.mockResolvedValue({ games: [game] });
});

test('opens a rule from its compact row and restores the query, pending filter and expanded game on return', async () => {
  render(<MemoryRouter initialEntries={[initial]}><Routes>
    <Route path="/catalog" element={<CatalogPage />} />
    <Route path="/games/:slug" element={<ReturnToCatalog />} />
  </Routes></MemoryRouter>);
  const rule = await screen.findByRole('link', { name: '原本展開的規則' });
  expect(rule).toHaveAttribute('href', '/games/shipyard#rule-rule-1');
  // Published rules carry no status mark, and the old tag filters and game-page link are gone.
  expect(screen.queryByText('已發布')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '依標籤篩選規則' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '開啟一般遊戲頁 ↗' })).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('船');
  expect(screen.getByRole('checkbox', { name: '只看待審核' })).toBeChecked();
  fireEvent.click(rule);
  fireEvent.click(await screen.findByRole('button', { name: '返回列表' }));
  expect(await screen.findByRole('link', { name: '原本展開的規則' })).toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('船');
  expect(screen.getByRole('checkbox', { name: '只看待審核' })).toBeChecked();
});

test('marks only rules that are not public', async () => {
  mocks.game.mockResolvedValue({ game: { ...game, rules: [
    ...game.rules,
    { id: 'rule-2', statement: '等待審核的規則', tags: [], categories: [], status: 'published', reviewStatus: 'pending', updatedAt: 1 },
    { id: 'rule-3', statement: '已隱藏的規則', tags: [], categories: [], status: 'hidden', updatedAt: 1 },
  ] } });
  render(<MemoryRouter initialEntries={[initial]}><CatalogPage /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: /等待審核的規則/ })).toHaveTextContent('未審核');
  expect(screen.getByRole('link', { name: /已隱藏的規則/ })).toHaveTextContent('已隱藏');
  expect(screen.getByRole('link', { name: '原本展開的規則' })).toHaveTextContent(/^原本展開的規則$/);
});

test('changing local filters does not reload an already expanded game', async () => {
  render(<MemoryRouter initialEntries={[initial]}><CatalogPage /></MemoryRouter>);
  await screen.findAllByText('原本展開的規則');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Shipyard' } });
  await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('Shipyard'));
  expect(mocks.game).toHaveBeenCalledTimes(1);
  expect(mocks.catalogGames).toHaveBeenCalledTimes(1);
});
