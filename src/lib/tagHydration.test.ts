import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './api';
import { hydrateRuleTags } from './tagHydration';
import type { RuleCard } from '../shared/types';

const rule = (tagIds: string[]): RuleCard => ({
  id: 'rule-1',
  gameId: 'game-1',
  statement: '測試規則',
  sourceLinks: [],
  status: 'published',
  tagIds,
  tags: [],
});

afterEach(() => vi.restoreAllMocks());

describe('hydrateRuleTags', () => {
  test('keeps every tag ID visible and marks an unresolved entity as 未知標籤', async () => {
    vi.spyOn(api, 'tags').mockResolvedValue({
      tags: [{ id: 'known', slug: 'known', name: '計分' }],
    });

    const [hydrated] = await hydrateRuleTags([rule(['known', 'missing'])]);

    expect(hydrated.tags).toEqual([
      { id: 'known', slug: 'known', name: '計分' },
      { id: 'missing', slug: 'missing', name: '未知標籤', unresolved: true },
    ]);
  });
});
