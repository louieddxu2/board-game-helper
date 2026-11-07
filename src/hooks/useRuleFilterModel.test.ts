import { describe, expect, test } from 'vitest';
import type { RuleCard } from '../shared/types';
import { orderTagOptions } from './useRuleFilterModel';

const rule = (id: string, tags: string[]): RuleCard => ({
  id, gameId: 'game', statement: id, status: 'published', sourceLinks: [],
  tags: tags.map((name) => ({ id: name, slug: name, name })),
});

describe('tag row order', () => {
  const rules = [rule('a', ['計分', '設置']), rule('b', ['設置', '行動']), rule('c', ['設置', '計分']), rule('d', ['終局'])];

  test('puts tags carried by more rules first, then orders equal counts by name, with no cap', () => {
    const options = orderTagOptions(rules, [], '');
    const tied = ['終局', '行動'].sort(new Intl.Collator('zh-Hant').compare);
    expect(options.map((option) => [option.name, option.count])).toEqual([['設置', 3], ['計分', 2], [tied[0], 1], [tied[1], 1]]);
    expect(options.every((option) => !option.selected)).toBe(true);
  });

  test('keeps selected tags first in the order they were chosen', () => {
    const shown = rules.filter((item) => item.tags.some((tag) => tag.name === '設置'));
    expect(orderTagOptions(shown, ['設置'], '').map((option) => [option.name, option.selected]))
      .toEqual([['設置', true], ['計分', false], ['行動', false]]);
  });

  test('narrows unselected tags by the search text but keeps the selected ones', () => {
    expect(orderTagOptions(rules, ['終局'], '計').map((option) => option.name)).toEqual(['終局', '計分']);
  });
});
