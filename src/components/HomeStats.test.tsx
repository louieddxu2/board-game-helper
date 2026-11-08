// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { HomeStats, siteStats } from './HomeStats';

const mocks = vi.hoisted(() => ({ catalogGames: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { catalogGames: mocks.catalogGames } }));

describe('HomeStats', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); mocks.catalogGames.mockReset(); });

  test('counts only games with public rules and adds up their rules', () => {
    expect(siteStats([{ ruleCount: 3, publishedRuleCount: 2 }, { ruleCount: 0, publishedRuleCount: 0 }, { ruleCount: 5 }])).toEqual({ games: 2, rules: 7 });
  });

  test('shows the counts once the game list arrives', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    mocks.catalogGames.mockResolvedValue({ games: [{ ruleCount: 4 }, { ruleCount: 2 }, { ruleCount: 0 }] });
    render(<HomeStats />);
    expect(await screen.findByText(/已收錄/)).toHaveTextContent('已收錄 2 款遊戲・6 條玩錯的規則');
  });

  test('shows nothing when the list cannot be read', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    mocks.catalogGames.mockRejectedValue(new Error('offline'));
    const { container } = render(<HomeStats />);
    await Promise.resolve();
    expect(container.querySelector('.home-stats')).toBeEmptyDOMElement();
  });
});
