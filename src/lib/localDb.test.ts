import { describe, expect, test } from 'vitest';
import { applyGameCatalogChangesToCache, isCachedRuleSetUsable, PUBLIC_TAG_CATALOG_FRESH_MS, type CachedGameRow } from './localDb';

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
