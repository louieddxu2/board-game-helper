// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { writeSiteMode } from '../lib/siteMode';
import { CatalogPage } from './CatalogPage';

const listed = [
  { id: 'g-a', slug: 'alpha', displayName: '甲遊戲', englishName: 'Alpha', aliases: [], ruleCount: 2, updatedAt: 10 },
  { id: 'g-b', slug: 'bravo', displayName: '乙遊戲', englishName: 'Bravo', aliases: [], ruleCount: 5, updatedAt: 20 },
];
const mocks = vi.hoisted(() => ({ session: { current: {} as Record<string, unknown> }, summary: vi.fn(), list: vi.fn(), game: vi.fn() }));
vi.mock('../context/SessionContext', () => ({ useSession: () => mocks.session.current }));
vi.mock('../lib/api', () => ({ api: { game: mocks.game, catalogGames: async () => ({ games: listed }), editorContributions: async () => ({ games: [], pendingGameIds: [] }) } }));
vi.mock('../lib/uncertainRulesApi', () => ({ uncertainRulesApi: { summary: mocks.summary, list: mocks.list } }));

let search = '';
const Probe = () => { search = useLocation().search; return null; };
const renderCatalog = (entry = '/catalog') => render(<MemoryRouter initialEntries={[entry]}><Routes>
  <Route path="/catalog" element={<><CatalogPage /><Probe /></>} />
</Routes></MemoryRouter>);
const rowNames = () => Array.from(document.querySelectorAll('.catalog-game-row .catalog-game-name')).map((cell) => cell.textContent);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mocks.session.current = { user: { id: 'admin' }, loading: false, canEdit: true, isAdmin: true };
  mocks.summary.mockReset().mockResolvedValue({ games: [
    { gameId: 'g-a', slug: 'alpha', displayName: '甲遊戲', englishName: 'Alpha', uncertainCount: 3, uncheckedCount: 1, latestUpdatedAt: 40 },
    { gameId: 'g-new', slug: 'new-game', displayName: '丙遊戲', englishName: null, uncertainCount: 1, uncheckedCount: 0, latestUpdatedAt: 50 },
  ] });
  mocks.list.mockReset().mockResolvedValue({ uncertainRules: [{ id: 'u1', gameId: 'g-new', question: '平手怎麼算？', checkedAt: 1, createdAt: 1, updatedAt: 1 }] });
  mocks.game.mockReset();
});
afterEach(() => { cleanup(); writeSiteMode('wrong'); vi.unstubAllGlobals(); });

test('an admin sees each game’s uncertain count and sorts by a column header', async () => {
  const user = userEvent.setup();
  renderCatalog();
  const alpha = (await screen.findByText('甲遊戲')).closest('tr') as HTMLElement;
  await waitFor(() => expect(within(alpha).getByText('・未查 1')).toBeInTheDocument());
  expect(rowNames()).toEqual(['甲遊戲', '乙遊戲']);
  await user.click(screen.getByRole('button', { name: /規則數/ }));
  expect(rowNames()).toEqual(['乙遊戲', '甲遊戲']);
  expect(search).toContain('sort=rules');
  expect(screen.getByRole('columnheader', { name: /規則數/ })).toHaveAttribute('aria-sort', 'descending');
  await user.click(screen.getByRole('button', { name: /規則數/ }));
  expect(rowNames()).toEqual(['甲遊戲', '乙遊戲']);
  expect(search).toContain('dir=asc');
});

test('the phone sort picker sorts the same way and keeps the choice in the address', async () => {
  const user = userEvent.setup();
  renderCatalog();
  await screen.findByText('甲遊戲');
  await user.selectOptions(screen.getByLabelText('排序'), '最後更新（新→舊）');
  expect(rowNames()).toEqual(['乙遊戲', '甲遊戲']);
  expect(search).toContain('sort=updated');
});

test('everyone else sees no uncertain column and loads no counts', async () => {
  mocks.session.current = { user: { id: 'user' }, loading: false, canEdit: false, isAdmin: false };
  renderCatalog();
  await screen.findByText('甲遊戲');
  expect(screen.queryByRole('columnheader', { name: /不確定/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /不確定/ })).not.toBeInTheDocument();
  expect(mocks.summary).not.toHaveBeenCalled();
});

test('the uncertain mode lists games with uncertain rules, rule-less ones too, and opens into their questions', async () => {
  const user = userEvent.setup();
  writeSiteMode('uncertain');
  renderCatalog();
  await screen.findByText('丙遊戲');
  expect(rowNames()).toEqual(['甲遊戲', '丙遊戲']);
  await user.click(screen.getByText('丙遊戲'));
  expect(await screen.findByRole('link', { name: /平手怎麼算？/ })).toHaveAttribute('href', '/games/new-game');
  expect(mocks.list).toHaveBeenCalledWith('g-new');
  expect(mocks.game).not.toHaveBeenCalled();
});
