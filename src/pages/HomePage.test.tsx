// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { HomePage } from './HomePage';

const mocks = vi.hoisted(() => ({ home: vi.fn(), getLatestHomeView: vi.fn() }));
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: null, loading: false, canEdit: false }) }));
vi.mock('../lib/api', () => ({ api: { home: mocks.home } }));
vi.mock('../lib/localDb', () => ({ localDb: {
  getLatestHomeView: mocks.getLatestHomeView, getDraft: async () => undefined, recentGames: async () => [],
  cacheRuleEntity: async () => undefined, cacheHomeView: async () => undefined,
} }));
vi.mock('../lib/tagHydration', () => ({ hydrateRuleTags: async (rules: unknown[]) => rules }));
vi.mock('../components/GameSearch', () => ({ GameSearch: () => <p>搜尋介面</p> }));
vi.mock('../components/RuleCard', () => ({ RuleCard: ({ rule }: { rule: { statement: string } }) => <p>{rule.statement}</p> }));
vi.mock('../components/AdSlot', () => ({ AdSlot: () => null }));
vi.mock('../components/PwaInstallButton', () => ({ PwaInstallButton: () => null }));

const emptyHome = { generatedAt: 1, featured: [], featuredRules: [], recentRules: [], recentRuleIds: [], popularGames: [] };
afterEach(cleanup);
beforeEach(() => {
  mocks.home.mockReset(); mocks.getLatestHomeView.mockReset();
  mocks.getLatestHomeView.mockResolvedValue(undefined);
});

test('replaces cold-load skeletons with a manual retry and leaves search available', async () => {
  mocks.home.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(emptyHome);
  const { container } = render(<MemoryRouter><HomePage /></MemoryRouter>);
  const retry = await screen.findByRole('button', { name: '重新載入首頁內容' });
  expect(container.querySelector('.skeleton-card')).toBeNull();
  expect(screen.getByText('搜尋介面')).toBeInTheDocument();
  expect(mocks.home).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  await screen.findByText('內容正在整理中。');
  expect(mocks.home).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('retains the previously rendered home content when refreshing fails', async () => {
  const cached = { ...emptyHome, featuredRules: [{ id: 'rule-1', statement: '先前可閱讀的規則', gameId: 'game-1', gameName: '船廠', gameSlug: 'shipyard', updatedAt: 1, status: 'published' }] };
  mocks.getLatestHomeView.mockResolvedValue({ data: cached });
  mocks.home.mockRejectedValueOnce(new Error('offline'));
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  expect(await screen.findByText('先前可閱讀的規則')).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('已保留目前內容');
  expect(mocks.home).toHaveBeenCalledTimes(1);
});
