import { describe, expect, test } from 'vitest';
import { applyRuleImportance, sortRulesByImportance, updateRuleImportanceCount } from './ruleImportance';
import type { RuleCard } from '../shared/types';

const rule = (id: string, importanceCount: number): RuleCard => ({
  id, gameId: 'g1', statement: id, status: 'published', sourceLinks: [], tags: [], importanceCount,
});

describe('rule importance presentation', () => {
  test('sorts high votes first and preserves existing order for ties', () => {
    expect(sortRulesByImportance([rule('a', 2), rule('b', 5), rule('c', 2)]).map((item) => item.id))
      .toEqual(['b', 'a', 'c']);
  });

  test('deduplicates repeated votes and supports cancellation', () => {
    expect(applyRuleImportance(['r1'], 'r1', true)).toEqual(['r1']);
    expect(applyRuleImportance(['r1'], 'r1', false)).toEqual([]);
  });

  test('updates only the matching count and never produces a negative count', () => {
    const updated = updateRuleImportanceCount([rule('a', 1), rule('b', 2)], 'a', -1);
    expect(updated.map((item) => item.importanceCount)).toEqual([0, 2]);
  });
});
