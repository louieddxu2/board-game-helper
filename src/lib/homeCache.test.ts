import { describe, expect, test } from 'vitest';
import { homeContentKey } from './homeCache';
import type { HomePayload, RuleCard } from '../shared/types';

const rule = (id: string, updatedAt: number): RuleCard & { gameName: string; gameSlug: string } => ({
  id,
  gameId: 'game-1',
  statement: `Rule ${id}`,
  status: 'published',
  sourceLinks: [],
  tags: [],
  updatedAt,
  gameName: 'Emberleaf',
  gameSlug: 'emberleaf',
});

const home = (): HomePayload => ({
  generatedAt: 1,
  featured: [],
  featuredRules: Array.from({ length: 6 }, (_, index) => rule(`featured-${index}`, 1)),
  recentRules: Array.from({ length: 6 }, (_, index) => rule(`recent-${index}`, 1)),
  popularGames: [],
});

describe('home cache content key', () => {
  test('refreshes the home snapshot when only a featured game’s published rule count changes', () => {
    const featured = { gameSlug: 'emberleaf', gameName: 'Emberleaf', ruleId: 'featured-0', publishedRuleCount: 1 };
    const before = { ...home(), featured: [featured] };
    const after = { ...before, featured: [{ ...featured, publishedRuleCount: 2 }] };

    expect(homeContentKey(after)).not.toBe(homeContentKey(before));
  });

  test('changes when any of the twelve rendered rule snapshots is updated', () => {
    const before = home();
    const after = home();
    after.recentRules[4] = { ...after.recentRules[4], updatedAt: 2 };

    expect(homeContentKey(after)).not.toBe(homeContentKey(before));
  });
});
