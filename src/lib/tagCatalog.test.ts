import { describe, expect, test } from 'vitest';
import type { TagSummary } from '../shared/types';
import { applyPublicTagCatalogChanges } from './tagCatalog';

const tag = (id: string, name: string): TagSummary => ({ id, slug: id, name, isPublic: true, aliases: [] });

describe('local public tag catalog', () => {
  test('applies updates and tombstones without replacing unchanged tags', () => {
    const result = applyPublicTagCatalogChanges([tag('a', 'A'), tag('b', 'B')], [
      { tagId: 'a', catalogVersion: 4, deleted: false, tag: { ...tag('a', '新 A'), aliases: ['別名'] } },
      { tagId: 'b', catalogVersion: 5, deleted: true },
    ]);

    expect(result).toEqual([{ ...tag('a', '新 A'), aliases: ['別名'] }]);
  });
});
