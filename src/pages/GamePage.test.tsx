import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GamePage } from './GamePage';

const mocks = vi.hoisted(() => ({
  game: vi.fn(),
  tags: vi.fn(),
  hydrateGameTags: vi.fn(),
}));

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ user: null, canEdit: false, isAdmin: false }),
}));
vi.mock('../context/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context/ToastContext')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { game: mocks.game, tags: mocks.tags },
}));
vi.mock('../lib/localDb', () => ({ localDb: {} }));
vi.mock('../components/GameSearch', () => ({ clearSearchCache: vi.fn() }));
vi.mock('../lib/tagHydration', () => ({ hydrateGameTags: mocks.hydrateGameTags }));
vi.mock('../lib/rulePermissions', () => ({ canUserEditRule: () => false, canUserReviewRule: () => false }));
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
    vi.clearAllMocks();
    mocks.game.mockResolvedValue({ game });
    mocks.tags.mockResolvedValue({ tags: [] });
    mocks.hydrateGameTags.mockImplementation(async (value: typeof game) => value);
  });

  afterEach(() => cleanup());

  const renderGamePage = (entry = '/games/test-game') => render(<MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/games/:identifier" element={<GamePage />} />
    </Routes>
  </MemoryRouter>);

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
});
