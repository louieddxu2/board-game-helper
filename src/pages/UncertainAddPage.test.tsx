import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { UncertainAddPage } from './UncertainAddPage';

const mocks = vi.hoisted(() => ({ game: vi.fn(), searchGames: vi.fn(), create: vi.fn(), confirm: vi.fn(), showToast: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { game: mocks.game, searchGames: mocks.searchGames } }));
vi.mock('../lib/uncertainRulesApi', () => ({ uncertainRulesApi: { create: mocks.create } }));
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
// The real search reads the catalog; here a plain field stands in for typing a name.
vi.mock('../components/GameSearch', () => ({
  GameSearch: ({ value, onChange }: { value: string; onChange(value: string): void }) => <input aria-label="搜尋遊戲" value={value} onChange={(event) => onChange(event.target.value)} />,
}));

const bean = { id: 'g1', slug: 'seize-the-bean', displayName: '柏林咖啡館', englishName: 'Seize the Bean', aliases: [], ruleCount: 0, updatedAt: 1, rules: [], variants: [] };
let path = '';
const Probe = () => { path = useLocation().pathname; return null; };
const renderPage = (entry: string) => render(<MemoryRouter initialEntries={[entry]}>
  <Routes><Route path="/add" element={<UncertainAddPage />} /><Route path="*" element={<Probe />} /></Routes>
</MemoryRouter>);

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.game.mockResolvedValue({ game: bean });
  mocks.searchGames.mockResolvedValue({ games: [] });
  mocks.confirm.mockResolvedValue(true);
});
afterEach(cleanup);

test('from a game page it records the question under that game with its settings', async () => {
  const user = userEvent.setup();
  mocks.create.mockResolvedValue({ uncertainRules: [{}], gameSlug: 'seize-the-bean', gameCreated: false });
  renderPage('/add?game=seize-the-bean');
  expect(await screen.findByDisplayValue('柏林咖啡館')).toBeInTheDocument();
  await user.type(screen.getByLabelText(/不確定的問題/), '平手怎麼算？');
  await user.type(screen.getByLabelText('我們這桌先這樣玩'), '平分');
  await user.click(screen.getByRole('checkbox', { name: '已查過BGG無答案' }));
  await user.click(screen.getByRole('button', { name: '儲存 1 題' }));
  expect(mocks.create).toHaveBeenCalledWith({ gameId: 'g1' }, [{
    question: '平手怎麼算？', tableRuling: '平分', details: '', categories: [], playerCounts: [], editionNotes: [], checked: true,
  }]);
  await waitFor(() => expect(path).toBe('/games/seize-the-bean'));
});

test('a name the catalog lacks becomes a new game after confirmation', async () => {
  const user = userEvent.setup();
  mocks.create.mockResolvedValue({ uncertainRules: [{}], gameSlug: 'new-game', gameCreated: true });
  renderPage('/add');
  await user.type(screen.getByLabelText('搜尋遊戲'), '新遊戲');
  await user.type(screen.getByLabelText(/英文名稱/), 'New Game');
  await user.type(screen.getByLabelText(/不確定的問題/), '可以嗎？');
  await user.click(screen.getByRole('button', { name: '儲存 1 題' }));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '建立新遊戲？' }));
  expect(mocks.create).toHaveBeenCalledWith({ newGame: { displayName: '新遊戲', englishName: 'New Game' } }, [expect.objectContaining({ question: '可以嗎？', checked: false })]);
  await waitFor(() => expect(path).toBe('/games/new-game'));
});

test('a typed name the catalog has selects that game instead of creating one', async () => {
  const user = userEvent.setup();
  mocks.searchGames.mockResolvedValue({ games: [bean] });
  renderPage('/add');
  await user.type(screen.getByLabelText('搜尋遊戲'), '柏林咖啡館');
  await user.type(screen.getByLabelText(/不確定的問題/), '可以嗎？');
  await user.click(screen.getByRole('button', { name: '儲存 1 題' }));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(await screen.findByDisplayValue('柏林咖啡館')).toHaveAttribute('readonly');
});

test('one record holds several questions, like recording several wrong rules', async () => {
  const user = userEvent.setup();
  mocks.create.mockResolvedValue({ uncertainRules: [{}, {}], gameSlug: 'seize-the-bean', gameCreated: false });
  renderPage('/add?game=seize-the-bean');
  await screen.findByDisplayValue('柏林咖啡館');
  expect(screen.getByLabelText(/不確定的問題/)).not.toHaveFocus();
  await user.type(screen.getByLabelText(/不確定的問題/), '第一題');
  await user.click(screen.getByRole('button', { name: '＋新增一題' }));
  // The first question folds into its summary and the new one is ready to type.
  expect(screen.getByRole('button', { name: '第一題' })).toBeInTheDocument();
  expect(screen.getByLabelText(/不確定的問題/)).toHaveFocus();
  await user.keyboard('第二題');
  await user.click(screen.getByRole('checkbox', { name: '已查過BGG無答案' }));
  await user.click(screen.getByRole('button', { name: '＋新增一題' }));
  await user.click(screen.getByRole('button', { name: '移除第 3 題' }));
  expect(screen.getByText('2 題')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '儲存 2 題' }));
  expect(mocks.create).toHaveBeenCalledWith({ gameId: 'g1' }, [
    expect.objectContaining({ question: '第一題', checked: false }),
    expect.objectContaining({ question: '第二題', checked: true }),
  ]);
});

test('reopening a folded question shows its fields again', async () => {
  const user = userEvent.setup();
  renderPage('/add?game=seize-the-bean');
  await screen.findByDisplayValue('柏林咖啡館');
  await user.type(screen.getByLabelText(/不確定的問題/), '第一題');
  await user.click(screen.getByRole('button', { name: '＋新增一題' }));
  await user.click(screen.getByRole('button', { name: '第一題' }));
  expect(screen.getByLabelText(/不確定的問題/)).toHaveValue('第一題');
  expect(screen.getByLabelText(/不確定的問題/)).toHaveFocus();
  expect(screen.getByRole('button', { name: '新增不確定的問題' })).toBeInTheDocument();
});
