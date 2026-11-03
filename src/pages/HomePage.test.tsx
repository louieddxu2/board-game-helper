// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { HomePage } from './HomePage';

const mocks = vi.hoisted(() => ({ home: vi.fn(), rule: vi.fn(), getLatestHomeView: vi.fn(), cacheHomeView: vi.fn(), cacheRuleEntity: vi.fn() }));
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ user: null, loading: false, canEdit: false }) }));
vi.mock('../lib/api', () => ({ api: { home: mocks.home, rule: mocks.rule } }));
vi.mock('../lib/localDb', () => ({ localDb: {
  getLatestHomeView: mocks.getLatestHomeView, getDraft: async () => undefined, recentGames: async () => [],
  cacheRuleEntity: mocks.cacheRuleEntity, cacheHomeView: mocks.cacheHomeView,
} }));
vi.mock('../lib/tagHydration', () => ({ hydrateRuleTags: async (rules: unknown[]) => rules }));
vi.mock('../components/GameSearch', () => ({ GameSearch: () => <p>搜尋介面</p> }));
vi.mock('../components/RuleCard', () => ({ RuleCard: ({ rule }: { rule: { statement: string } }) => <p>{rule.statement}</p> }));
vi.mock('../components/AdSlot', () => ({ AdSlot: () => null }));
vi.mock('../components/PwaInstallButton', () => ({ PwaInstallButton: () => null }));

const emptyHome = { generatedAt: 1, featured: [], featuredRules: [], recentRules: [], recentRuleIds: [], popularGames: [] };
afterEach(cleanup);
beforeEach(() => {
  mocks.home.mockReset(); mocks.rule.mockReset(); mocks.getLatestHomeView.mockReset();
  mocks.cacheHomeView.mockReset().mockResolvedValue(undefined);
  mocks.cacheRuleEntity.mockReset().mockResolvedValue(undefined);
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
  // With no viewed games the featured section is left out instead of filled with other games.
  await waitFor(() => expect(screen.queryByRole('heading', { name: '近期常被查閱的遊戲' })).not.toBeInTheDocument());
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

test('lists recent rules as links that open the rule on its game page', async () => {
  mocks.home.mockResolvedValueOnce({ ...emptyHome, recentRules: [{ id: 'rule 7', statement: '產業軌所有人都可以走到最後一格。', gameId: 'game-2', gameName: '甜蜜國度', gameSlug: 'sweet', updatedAt: 1, status: 'published', sourceLinks: [] }] });
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  const link = await screen.findByRole('link', { name: /甜蜜國度\s*產業軌所有人都可以走到最後一格。/ });
  expect(link).toHaveAttribute('href', '/games/sweet#rule-rule%207');
});

const recoveredRule = { id: 'retry-rule', statement: '恢復後的規則', gameId: 'retry-game', gameName: '重試遊戲', gameSlug: 'retry-game', status: 'published', tags: [], sourceLinks: [] };

for (const section of ['featured', 'recent'] as const) {
  test(`retries failed ${section} rules even when the home payload has not changed`, async () => {
    const payload = section === 'featured'
      ? { ...emptyHome, featured: [{ gameName: recoveredRule.gameName, gameSlug: recoveredRule.gameSlug, ruleId: recoveredRule.id }] }
      : { ...emptyHome, recentRuleIds: [recoveredRule.id] };
    mocks.home.mockResolvedValue(payload);
    mocks.rule.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ rule: recoveredRule });
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('首頁內容暫時無法載入');
    expect(mocks.cacheHomeView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新載入首頁內容' }));
    expect(await screen.findByText(recoveredRule.statement, { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mocks.home).toHaveBeenCalledTimes(2);
    expect(mocks.rule).toHaveBeenCalledTimes(2);
    expect(mocks.cacheHomeView).toHaveBeenCalledWith(expect.objectContaining({
      [section === 'featured' ? 'featuredRules' : 'recentRules']: [recoveredRule],
    }));
  });
}

test('retains the rendered snapshot when referenced rules cannot be refreshed', async () => {
  const cachedRule = { ...recoveredRule, id: 'cached-rule', statement: '快取中的規則' };
  mocks.getLatestHomeView.mockResolvedValue({ data: { ...emptyHome, featuredRules: [cachedRule] } });
  const featured = [{ gameName: recoveredRule.gameName, gameSlug: recoveredRule.gameSlug, ruleId: recoveredRule.id }];
  mocks.home.mockResolvedValue({ ...emptyHome, generatedAt: 2, featured });
  mocks.rule.mockRejectedValue(new Error('unavailable'));
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('已保留目前內容');
  expect(screen.getByText(cachedRule.statement)).toBeInTheDocument();
  expect(mocks.cacheHomeView).not.toHaveBeenCalledWith(expect.objectContaining({ featured }));
});

test('keeps successfully loaded rules readable when writing the local cache fails', async () => {
  mocks.home.mockResolvedValue({ ...emptyHome, featuredRules: [recoveredRule] });
  mocks.cacheRuleEntity.mockRejectedValue(new Error('storage unavailable'));
  mocks.cacheHomeView.mockRejectedValue(new Error('storage unavailable'));
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  expect(await screen.findByText(recoveredRule.statement)).toBeInTheDocument();
  await waitFor(() => expect(mocks.cacheHomeView).toHaveBeenCalled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
