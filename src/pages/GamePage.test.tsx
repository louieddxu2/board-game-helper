import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GamePage } from './GamePage';
import { uiHistory } from '../workspace/uiHistory';
import type { SessionUser } from '../shared/types';

const mocks = vi.hoisted(() => ({
  game: vi.fn(),
  ruleFresh: vi.fn(),
  tags: vi.fn(),
  hydrateGameTags: vi.fn(),
  hydrateRuleTags: vi.fn(),
  user: null as SessionUser | null,
  canEdit: false,
  isAdmin: false,
  createGameExternalResource: vi.fn(),
  deleteGameExternalResource: vi.fn(),
  invalidateGame: vi.fn(),
  favoriteStatus: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  markFavoriteSeen: vi.fn(),
  recordView: vi.fn(),
  ruleImportance: vi.fn(),
}));

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: mocks.user, canEdit: mocks.canEdit, isAdmin: mocks.isAdmin }),
}));
vi.mock('../context/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/ToastContext')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    game: mocks.game,
    ruleFresh: mocks.ruleFresh,
    tags: mocks.tags,
    createGameExternalResource: mocks.createGameExternalResource,
    deleteGameExternalResource: mocks.deleteGameExternalResource,
    favoriteStatus: mocks.favoriteStatus,
    addFavorite: mocks.addFavorite,
    removeFavorite: mocks.removeFavorite,
    markFavoriteSeen: mocks.markFavoriteSeen,
    recordView: mocks.recordView,
    ruleImportance: mocks.ruleImportance,
  },
}));
vi.mock('../lib/localDb', () => ({ localDb: { invalidateGame: mocks.invalidateGame } }));
vi.mock('../components/GameSearch', () => ({ clearSearchCache: vi.fn() }));
vi.mock('../lib/tagHydration', () => ({ hydrateGameTags: mocks.hydrateGameTags, hydrateRuleTags: mocks.hydrateRuleTags }));
vi.mock('../lib/rulePermissions', () => ({ canUserEditRule: vi.fn(() => false), canUserReviewRule: vi.fn(() => false) }));
vi.mock('../components/FavoriteLimitDialog', () => ({ FavoriteLimitDialog: () => null }));

const game = {
  id: 'game-1', slug: 'test-game', displayName: '測試遊戲', aliases: [], ruleCount: 2, updatedAt: 1,
  reviewStatus: 'not_required' as const,
  rules: [
    { id: 'rule-1', gameId: 'game-1', statement: '第一條正確規則', commonMistake: '第一條玩錯情況', status: 'published' as const, tags: [], sourceLinks: [] },
    { id: 'rule-2', gameId: 'game-1', statement: '第二條正確規則', commonMistake: '第二條玩錯情況', status: 'published' as const, tags: [], sourceLinks: [] },
  ],
};

describe('GamePage compact rule view', () => {
  beforeEach(() => {
    uiHistory.dispose();
    window.history.pushState({ idx: (window.history.state?.idx ?? 0) + 1 }, '', '/games/test-game');
    vi.clearAllMocks();
    mocks.user = null;
    mocks.canEdit = false;
    mocks.isAdmin = false;
    mocks.game.mockResolvedValue({ game });
    mocks.ruleFresh.mockResolvedValue(game.rules[0]);
    mocks.tags.mockResolvedValue({ tags: [] });
    mocks.hydrateGameTags.mockImplementation(async (value: typeof game) => value);
    mocks.hydrateRuleTags.mockImplementation(async (rules: typeof game.rules) => rules);
    mocks.favoriteStatus.mockResolvedValue({ favorite: false, favoriteCount: 0 });
    mocks.addFavorite.mockResolvedValue({ wasFirst: false });
    mocks.removeFavorite.mockResolvedValue({});
    mocks.markFavoriteSeen.mockResolvedValue({ ok: true });
    mocks.recordView.mockResolvedValue({ ok: true });
    mocks.ruleImportance.mockResolvedValue({ ruleIds: [] });
  });

  afterEach(async () => {
    cleanup();
    await waitFor(() => expect(window.history.state?.__boardGameHelperWorkspaceUi).toBeUndefined());
    uiHistory.dispose();
  });

  const renderGamePage = (entry = '/games/test-game') => render(<MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/games/:identifier" element={<GamePage />} />
    </Routes>
  </MemoryRouter>);

  test.each(['/games/test-game', '/games/test-game?category=flow_endgame_scoring'])(
    'hides empty indexes without hiding other rules at %s', async (entry) => {
      mocks.game.mockResolvedValue({ game: { ...game, rules: [
        { ...game.rules[0], categories: ['teaching_setup_opening'] },
        { ...game.rules[1], tags: [{ id: 'action-tag', slug: 'action', name: '行動', categoryHints: ['action_effect_detail'] }] },
      ] } });
      const { container } = renderGamePage(entry);
      const index = await screen.findByRole('group', { name: '規則快速索引' });
      const opening = within(index).getByRole('button', { name: '教學、設置、開局' });
      const action = within(index).getByRole('button', { name: '行動、效果、細節' });
      expect(opening).toBeEnabled();
      expect(action).toBeEnabled();
      expect(within(index).queryByRole('button', { name: '流程、終局、計分' })).not.toBeInTheDocument();
      expect(within(index).getAllByRole('button')).toHaveLength(2);
      expect(container.querySelectorAll('.rule-card-compact')).toHaveLength(2);
      await userEvent.setup().click(opening);
      expect(container.querySelectorAll('.rule-card-compact')).toHaveLength(1);
      expect(action).toBeEnabled();
      await userEvent.setup().click(action);
      expect(screen.getByText('第二條正確規則')).toBeInTheDocument();
      expect(opening).toBeEnabled();
    },
  );

  test('omits the index row when no category has any rules', async () => {
    const { container } = renderGamePage();
    await screen.findByText('第一條正確規則');
    expect(screen.queryByRole('group', { name: '規則快速索引' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('.rule-card-compact')).toHaveLength(2);
    expect(screen.getByRole('searchbox', { name: '關鍵字搜尋' })).toBeInTheDocument();
  });

  test('enables an automatically detected category from the loaded public tag keywords', async () => {
    mocks.tags.mockResolvedValue({ tags: [{ id: 'scoring-tag', slug: 'scoring', name: '計分',
      categoryHints: ['flow_endgame_scoring'], detectionKeywords: ['第一條'] }] });
    const { container } = renderGamePage();
    const index = await screen.findByRole('group', { name: '規則快速索引' });
    const scoring = within(index).getByRole('button', { name: '流程、終局、計分' });
    await waitFor(() => expect(scoring).toBeEnabled());
    await userEvent.setup().click(scoring);
    expect(container.querySelectorAll('.rule-card-compact')).toHaveLength(1);
    expect(screen.getByText('第一條正確規則')).toBeInTheDocument();
  });

  test('clears a shared category index without clearing the search or rereading the game', async () => {
    mocks.game.mockResolvedValue({ game: { ...game, rules: [
      { ...game.rules[0], categories: ['teaching_setup_opening'] },
      { ...game.rules[1], categories: ['action_effect_detail'] },
    ] } });
    const { container } = renderGamePage('/games/test-game?category=teaching_setup_opening&find=第一條');
    const index = await screen.findByRole('group', { name: '規則快速索引' });
    const opening = within(index).getByRole('button', { name: '教學、設置、開局' });
    expect(opening).toHaveAttribute('aria-pressed', 'true');
    expect(within(index).getAllByRole('button')).toHaveLength(2);
    await userEvent.setup().click(opening);
    expect(opening).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('searchbox', { name: '關鍵字搜尋' })).toHaveValue('第一條');
    expect(container.querySelectorAll('.rule-card-compact')).toHaveLength(1);
    expect(mocks.game).toHaveBeenCalledOnce();
  });

  test('starts compact, toggles the same rule closed, and keeps only one rule expanded', async () => {
    const originalMatchMedia = window.matchMedia;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const matchMedia = vi.fn(() => ({ matches: false }));
    const scrollIntoView = vi.fn();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });

    try {
      const { container } = renderGamePage();
      await screen.findByText('第一條正確規則');
      expect(container.querySelectorAll('.rule-card-compact')).toHaveLength(2);

      fireEvent.click(screen.getByText('第一條正確規則'));
      await waitFor(() => expect(container.querySelectorAll('.rule-card')).toHaveLength(1));
      expect(container.querySelectorAll('.rule-card-compact')).toHaveLength(1);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });

      matchMedia.mockReturnValue({ matches: true });
      fireEvent.click(screen.getByText('第二條正確規則'));
      await waitFor(() => expect(container.querySelectorAll('.rule-card')).toHaveLength(1));
      expect(container.querySelector('#rule-rule-1')).toHaveClass('rule-card-compact');
      expect(container.querySelector('#rule-rule-2')).toHaveClass('rule-card');
      expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'center' });

      fireEvent.click(container.querySelector('#rule-rule-2') as HTMLElement);
      expect(container.querySelector('#rule-rule-2')).toHaveClass('rule-card');
      fireEvent.click(screen.getByText('第二條正確規則'));
      await waitFor(() => expect(container.querySelectorAll('.rule-card-compact')).toHaveLength(2));
      expect(container.querySelectorAll('.rule-card')).toHaveLength(0);
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView });
    }
  });

  test('opens and scrolls to the rule targeted by a shared hash link', async () => {
    const originalMatchMedia = window.matchMedia;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true })) });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });

    try {
      const { container } = renderGamePage('/games/test-game#rule-rule-2');
      await waitFor(() => expect(container.querySelector('#rule-rule-2')).toHaveClass('rule-card'));
      expect(container.querySelector('#rule-rule-1')).toHaveClass('rule-card-compact');
      expect(screen.getByRole('button', { name: '第二條正確規則' })).toHaveAttribute('aria-expanded', 'true');
      await waitFor(() => expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'center' }));
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView });
    }
  });

  test('keeps search-only states free of the selected-filter row and reset action', async () => {
    const user = userEvent.setup();
    renderGamePage();

    const search = await screen.findByRole('searchbox', { name: '關鍵字搜尋' });
    expect(screen.queryByLabelText('已選標籤')).not.toBeInTheDocument();

    await user.type(search, '第一條');
    await waitFor(() => expect(screen.getByText('第一條正確規則')).toBeInTheDocument());
    expect(screen.queryByLabelText('已選標籤')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /清除篩選/ })).not.toBeInTheDocument();

    await user.clear(search);
    await waitFor(() => expect(screen.getByText('第二條正確規則')).toBeInTheDocument());

    await user.type(search, '完全不存在的關鍵字');
    await waitFor(() => expect(screen.getByText('找不到符合目前條件的規則。')).toBeInTheDocument());
    expect(screen.queryByLabelText('已選標籤')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /清除篩選/ })).not.toBeInTheDocument();

    await user.clear(search);
    await waitFor(() => expect(screen.getByText('第一條正確規則')).toBeInTheDocument());
    expect(screen.queryByText('找不到符合目前條件的規則。')).not.toBeInTheDocument();
  });

  test('treats a find URL as search-only state', async () => {
    renderGamePage('/games/test-game?find=第一條');

    const search = await screen.findByRole('searchbox', { name: '關鍵字搜尋' });
    expect(search).toHaveValue('第一條');
    expect(screen.getByText('第一條正確規則')).toBeInTheDocument();
    expect(screen.queryByLabelText('已選標籤')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /清除篩選/ })).not.toBeInTheDocument();
  });

  test.each(['tag', 'player', 'edition'] as const)('keeps a selected %s filter visible while searching', async (filterKind) => {
    const user = userEvent.setup();
    const taggedGame = {
      ...game,
      rules: [
        {
          ...game.rules[0],
          tags: [{ id: 'tag-setup', slug: 'setup', name: '設置' }],
          playerCounts: [2],
          editionNotes: ['標準版'],
        },
        game.rules[1],
      ],
    };
    mocks.game.mockResolvedValue({ game: taggedGame });
    renderGamePage();

    await screen.findByText('第一條正確規則');
    const tagFilter = document.querySelector('.tag-filter') as HTMLElement;
    const specialFilter = document.querySelector('.special-tag-filter') as HTMLElement;
    if (filterKind === 'tag') {
      await user.click(within(tagFilter).getByRole('button', { name: '#設置' }));
    } else if (filterKind === 'player') {
      await user.click(within(specialFilter).getByRole('button', { name: /2人$/ }));
    } else {
      await user.click(within(specialFilter).getByRole('button', { name: /標準版$/ }));
    }

    const selectedRow = screen.getByLabelText('已選標籤');
    expect(selectedRow).toBeInTheDocument();
    expect(selectedRow).toHaveTextContent(filterKind === 'tag' ? '#設置' : filterKind === 'player' ? '2人' : '標準版');
    expect(screen.getByRole('button', { name: /清除篩選/ })).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: '關鍵字搜尋' });
    await user.type(search, '第一條');
    expect(screen.getByLabelText('已選標籤')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /清除篩選/ })).toBeInTheDocument();

    const selectedFilterPattern = filterKind === 'tag' ? /#設置.*✕/ : filterKind === 'player' ? /2人.*✕/ : /標準版.*✕/;
    await user.click(within(screen.getByLabelText('已選標籤')).getByRole('button', { name: selectedFilterPattern }));
    await waitFor(() => expect(screen.queryByLabelText('已選標籤')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /清除篩選/ })).not.toBeInTheDocument();
    expect(search).toHaveValue('第一條');
  });

  test('keeps favorite state visible and ignores a second tap while saving', async () => {
    const user = userEvent.setup();
    mocks.user = { id: 'reader-1', maskedEmail: 'r***r@example.com', roles: [] };
    let resolveAdd!: (value: { wasFirst: boolean }) => void;
    mocks.addFavorite.mockReturnValue(new Promise((resolve) => { resolveAdd = resolve; }));

    renderGamePage();

    const favorite = await screen.findByRole('button', { name: '收藏遊戲' });
    expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await user.click(favorite);
    await waitFor(() => expect(screen.getByRole('button', { name: '正在處理收藏' })).toBeDisabled());

    await user.click(screen.getByRole('button', { name: '正在處理收藏' }));
    expect(mocks.addFavorite).toHaveBeenCalledOnce();

    resolveAdd({ wasFirst: false });
    await waitFor(() => expect(screen.getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true'));

    await user.click(screen.getByRole('button', { name: '取消收藏' }));
    await waitFor(() => expect(mocks.removeFavorite).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: '收藏遊戲' })).toHaveAttribute('aria-pressed', 'false'));
  });

  test('does not expose edit or review actions to a regular non-owner', async () => {
    mocks.user = { id: 'reader-1', maskedEmail: 'r***r@example.com', roles: [] };
    mocks.game.mockResolvedValue({ game: { ...game, reviewStatus: 'pending', renameOwnerId: 'another-user' } });

    renderGamePage();

    await screen.findByRole('button', { name: '收藏遊戲' });
    expect(screen.queryByRole('button', { name: '編輯遊戲名稱' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '審核遊戲' })).not.toBeInTheDocument();
  });

  test('keeps editor pending-game actions and locked-name state distinct', async () => {
    mocks.user = { id: 'editor-1', maskedEmail: 'e***r@example.com', roles: ['editor'] };
    mocks.canEdit = true;
    mocks.game.mockResolvedValue({ game: { ...game, reviewStatus: 'pending', renameOwnerId: 'another-user' } });

    const { unmount } = renderGamePage();
    await screen.findByRole('button', { name: '編輯遊戲名稱' });
    expect(screen.getByRole('button', { name: '審核遊戲' })).toBeInTheDocument();
    unmount();

    mocks.game.mockResolvedValue({ game: { ...game, reviewStatus: 'not_required', renameOwnerId: 'another-user', renameLocked: true } });
    renderGamePage();
    await screen.findByRole('button', { name: '收藏遊戲' });
    expect(screen.getByLabelText('遊戲名稱已鎖定')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編輯遊戲名稱' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '審核遊戲' })).not.toBeInTheDocument();
  });

  test('keeps external resource creation in a separate modal and closes only the top layer from browser back', async () => {
    mocks.canEdit = true;
    mocks.game.mockResolvedValue({ game: {
      ...game,
      externalResources: [{ id: 'resource-1', gameId: 'game-1', name: '官方教學', category: 'teaching', url: 'https://example.com/teach' }],
    } });
    renderGamePage();

    await userEvent.setup().click(await screen.findByRole('button', { name: /外部資源/ }));
    expect(screen.getByRole('dialog', { name: '外部資源' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '新增外部資源' })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: '新增' }));
    expect(screen.getByRole('dialog', { name: '新增外部資源' })).toBeInTheDocument();

    const addBackdrop = document.querySelector('.external-resource-add-backdrop')!;
    fireEvent.pointerDown(addBackdrop);
    expect(screen.getByRole('dialog', { name: '新增外部資源' })).toBeInTheDocument();

    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增外部資源' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: '外部資源' })).toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('refreshes the rule snapshot before opening an editor', async () => {
    const originalMatchMedia = window.matchMedia;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    mocks.canEdit = true;
    const freshRule = { ...game.rules[0], statement: '最新規則內容', updatedAt: 2 };
    mocks.game.mockResolvedValue({ game: { ...game, rules: [{ ...game.rules[0], updatedAt: 1 }, game.rules[1]] } });
    mocks.ruleFresh.mockResolvedValue(freshRule);
    const rulePermissions = await import('../lib/rulePermissions');
    vi.mocked(rulePermissions.canUserEditRule).mockReturnValue(true);

    try {
      renderGamePage();
      await screen.findByText('第一條正確規則');
      fireEvent.click(screen.getByText('第一條正確規則'));
      fireEvent.click(await screen.findByRole('button', { name: '編輯' }));

      await waitFor(() => expect(screen.getByDisplayValue('最新規則內容')).toBeInTheDocument());
      expect(mocks.ruleFresh).toHaveBeenCalledWith('rule-1');
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView });
    }
  });
});
