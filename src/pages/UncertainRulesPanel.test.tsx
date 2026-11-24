import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { GameDetail, UncertainRule } from '../shared/types';
import { requestUncertainRuleAdd } from '../lib/siteMode';
import { UncertainRulesPanel } from './UncertainRulesPanel';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), showToast: vi.fn(), confirm: vi.fn(),
}));
vi.mock('../lib/uncertainRulesApi', () => ({ uncertainRulesApi: { list: mocks.list, create: mocks.create, update: mocks.update, remove: mocks.remove } }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }));

const game = { id: 'g1', slug: 'bean', displayName: '柏林咖啡館', englishName: 'Seize the Bean', aliases: [], rules: [] } as unknown as GameDetail;
const rule = (id: string, question: string, checkedAt: number | null): UncertainRule => ({ id, gameId: 'g1', question, checkedAt, createdAt: 1, updatedAt: 1 });

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.list.mockResolvedValue({ uncertainRules: [rule('a', '能啟動兩次嗎？', new Date(2026, 10, 20).getTime()), rule('b', '平手怎麼算？', null)] });
});
afterEach(cleanup);

const renderDialog = () => render(<MemoryRouter><UncertainRulesPanel game={game} /></MemoryRouter>);
const item = (question: string) => screen.getByText(question).closest('.uncertain-rule-item') as HTMLElement;

test('shows whether each question was looked up, with the date', async () => {
  renderDialog();
  expect(await screen.findByText('已查過，沒有・2026-11-20')).toBeInTheDocument();
  expect(within(item('平手怎麼算？')).getByText('沒查過')).toBeInTheDocument();
});

test('copies only the selected questions as one post, plain or for AI', async () => {
  const user = userEvent.setup();
  renderDialog();
  await screen.findByText('能啟動兩次嗎？');
  expect(screen.getByRole('button', { name: '複製發文' })).toBeDisabled();
  await user.click(within(item('能啟動兩次嗎？')).getByRole('checkbox'));
  expect(screen.getByText('已選 1 題')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '複製發文' }));
  const post = await navigator.clipboard.readText();
  expect(post).toContain('Title: Rules question about Seize the Bean');
  expect(post).toContain('Q. 能啟動兩次嗎？');
  expect(post).not.toContain('平手怎麼算？');
  await user.click(screen.getByRole('button', { name: '複製給 AI' }));
  expect(await navigator.clipboard.readText()).toMatch(/^請把下面這篇 BoardGameGeek 規則提問翻成自然的英文。[\s\S]*Q\. 能啟動兩次嗎？/);
});

test('marking a question looked up shows the returned date', async () => {
  const user = userEvent.setup();
  mocks.update.mockResolvedValue({ uncertainRule: rule('b', '平手怎麼算？', new Date(2026, 10, 24).getTime()) });
  renderDialog();
  await screen.findByText('平手怎麼算？');
  await user.click(within(item('平手怎麼算？')).getByRole('button', { name: '查過了，沒有' }));
  expect(mocks.update).toHaveBeenCalledWith('g1', 'b', { checked: true });
  expect(await within(item('平手怎麼算？')).findByText('已查過，沒有・2026-11-24')).toBeInTheDocument();
});

test('the add request from the header or hero opens the editor for a new question', async () => {
  const user = userEvent.setup();
  mocks.create.mockResolvedValue({ uncertainRule: { ...rule('c', '可以棄牌嗎？', null), tableRuling: '可以' } });
  renderDialog();
  await screen.findByText('平手怎麼算？');
  act(() => requestUncertainRuleAdd());
  const question = screen.getByLabelText('問題');
  expect(question).toHaveFocus();
  await user.type(question, '可以棄牌嗎？');
  await user.type(screen.getByLabelText(/我們這桌先這樣玩/), '可以');
  await user.click(screen.getByRole('button', { name: '儲存' }));
  expect(mocks.create).toHaveBeenCalledWith('g1', { question: '可以棄牌嗎？', tableRuling: '可以', checked: false });
  expect(await screen.findByText('先這樣玩：可以')).toBeInTheDocument();
});

test('an empty list offers to note the first question', async () => {
  const user = userEvent.setup();
  mocks.list.mockResolvedValue({ uncertainRules: [] });
  renderDialog();
  await user.click(await screen.findByRole('button', { name: '記下第一題' }));
  expect(screen.getByRole('dialog', { name: '記下不確定的規則' })).toBeInTheDocument();
});
