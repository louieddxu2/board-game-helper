import { describe, expect, test } from 'vitest';
import { applyGameCatalogChangesToCache, applyGameReferenceUpdate, isCachedRuleSetUsable, PUBLIC_TAG_CATALOG_FRESH_MS, RULE_IMPORTANCE_CACHE_FRESH_MS, toStoredRule, type CachedGameRow } from './localDb';
import type { GameSummary, HomePayload, RuleCard } from '../shared/types';

const now = 10_000_000;

const cachedGame = (overrides: Partial<CachedGameRow> = {}): CachedGameRow => ({
  id: 'game-1',
  slug: 'emberleaf',
  displayName: 'Emberleaf',
  aliases: [],
  ruleCount: 1,
  publishedRuleCount: 1,
  totalRuleCount: 2,
  latestRuleUpdatedAt: 500,
  updatedAt: 500,
  cachedAt: now,
  rulesFetchedAt: now - 1_000,
  rulesComplete: false,
  rulesVersion: 500,
  ...overrides,
});

describe('normalized game rule cache freshness', () => {
  test('accepts a matching public rule collection for one hour', () => {
    expect(isCachedRuleSetUsable(cachedGame(), false, now)).toBe(true);
  });

  test('does not mistake a public rule collection for the editor collection', () => {
    expect(isCachedRuleSetUsable(cachedGame(), true, now)).toBe(false);
    expect(isCachedRuleSetUsable(cachedGame({ rulesComplete: true }), true, now)).toBe(true);
  });

  test('invalidates rules when the game list reports a newer rule version', () => {
    expect(isCachedRuleSetUsable(cachedGame({ latestRuleUpdatedAt: 501 }), false, now)).toBe(false);
  });

  test('expires a matching rule collection after one hour', () => {
    expect(isCachedRuleSetUsable(cachedGame({ rulesFetchedAt: now - 60 * 60 * 1000 }), false, now)).toBe(false);
  });
});

describe('public tag catalog freshness', () => {
  test('checks version updates once per week', () => {
    expect(PUBLIC_TAG_CATALOG_FRESH_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('rule importance cache freshness', () => {
  test('checks the signed-in vote list every ten minutes', () => {
    expect(RULE_IMPORTANCE_CACHE_FRESH_MS).toBe(10 * 60 * 1000);
  });
});

describe('normalized rule tag storage', () => {
  test('stores tag IDs as the source of truth without duplicating hydrated tag text', () => {
    const stored = toStoredRule({
      id: 'rule-1', gameId: 'game-1', statement: '測試規則', sourceLinks: [], status: 'published',
      tagIds: ['tag-score'], tags: [{ id: 'tag-score', slug: 'score', name: '計分' }],
    });

    expect(stored.tagIds).toEqual(['tag-score']);
    expect(stored.tags).toEqual([]);
  });
});

describe('weekly game catalog snapshot age', () => {
  test('delta checks refresh the sync cursor without extending the full-snapshot lifetime', () => {
    const snapshotFetchedAt = 100;
    const updated = applyGameCatalogChangesToCache({
      key: 'games:list:versioned:v2',
      data: { generation: 1, throughVersion: 5, generatedAt: 90, games: [] },
      cachedAt: 110,
      snapshotFetchedAt,
    }, {
      changes: [],
      throughVersion: 5,
      hasMore: false,
    }, 200);

    expect(updated.cachedAt).toBe(200);
    expect(updated.snapshotFetchedAt).toBe(snapshotFetchedAt);
  });
});

describe('local home references after game mutations', () => {
  const source: GameSummary = { id: 'game-source', slug: 'old-name', displayName: '舊名稱', ruleCount: 1, updatedAt: 1 };
  const target: GameSummary = { id: 'game-target', slug: 'new-name', displayName: '新名稱', ruleCount: 2, updatedAt: 2 };
  const rule = (overrides: Partial<RuleCard> = {}) => ({
    id: 'rule-1', gameId: source.id, statement: '更新前', sourceLinks: [], status: 'published', tags: [],
    gameName: source.displayName, gameSlug: source.slug, ...overrides,
  }) as RuleCard & { gameName: string; gameSlug: string };
  const home = (sourceRule = rule()): HomePayload => ({
    generatedAt: 1,
    featured: [{ gameSlug: source.slug, gameName: source.displayName, ruleId: sourceRule.id }],
    featuredRules: [sourceRule],
    recentRules: [sourceRule],
    popularGames: [source],
  });

  test('updates every cached home copy when a game is renamed', () => {
    const updated = applyGameReferenceUpdate(home(), undefined, { ...source, displayName: '新名稱', updatedAt: 3 }, new Map());

    expect(updated.featured[0]).toMatchObject({ gameSlug: source.slug, gameName: '新名稱' });
    expect(updated.featuredRules[0]).toMatchObject({ gameName: '新名稱', gameSlug: source.slug });
    expect(updated.recentRules[0]).toMatchObject({ gameName: '新名稱', gameSlug: source.slug });
  });

  test('moves cached rules and removes the source game after a merge', () => {
    const updatedRule = rule({ statement: '合併後規則' });
    const updated = applyGameReferenceUpdate(home(), source, target, new Map([[updatedRule.id, updatedRule]]));

    expect(updated.featured[0]).toMatchObject({ gameSlug: target.slug, gameName: target.displayName });
    expect(updated.featuredRules[0]).toMatchObject({ gameId: target.id, statement: '合併後規則', gameName: target.displayName, gameSlug: target.slug });
    expect(updated.recentRules[0]).toMatchObject({ gameId: target.id, gameName: target.displayName, gameSlug: target.slug });
    expect(updated.popularGames).toEqual([target]);
  });

  test('updates all featured and recent rule snapshots when one rule is edited', () => {
    const editedRule = rule({ statement: '???隤?嚗?', updatedAt: 4 });
    const data = home(editedRule);
    data.featuredRules = Array.from({ length: 6 }, (_, index) => rule({ id: `featured-${index}`, statement: `featured-${index}` }));
    data.recentRules = Array.from({ length: 6 }, (_, index) => rule({ id: `recent-${index}`, statement: `recent-${index}` }));
    data.featuredRules[2] = editedRule;
    data.recentRules[4] = editedRule;

    const updated = applyGameReferenceUpdate(data, undefined, source, new Map([[editedRule.id, editedRule]]));

    expect(updated.featuredRules[2]).toMatchObject({ statement: editedRule.statement, updatedAt: editedRule.updatedAt });
    expect(updated.recentRules[4]).toMatchObject({ statement: editedRule.statement, updatedAt: editedRule.updatedAt });
    expect(updated.featuredRules).toHaveLength(6);
    expect(updated.recentRules).toHaveLength(6);
  });
});
