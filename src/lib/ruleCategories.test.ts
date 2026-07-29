import { describe, expect, test } from 'vitest';
import type { RuleCard } from '../shared/types';
import { filterRulesByCategory } from './ruleCategories';

const rule = (id: string, categories?: RuleCard['categories']): RuleCard => ({
  id,
  gameId: 'game',
  statement: id,
  categories,
  status: 'published',
  tags: [],
  sourceLinks: [],
});

describe('rule category filters', () => {
  const rules = [
    rule('uncategorized'),
    rule('setup', ['teaching_setup_opening']),
    rule('shared', ['action_effect_detail', 'flow_endgame_scoring']),
  ];

  test('keeps uncategorized and multi-category rules exactly once in all', () => {
    expect(filterRulesByCategory(rules, 'all').map(({ id }) => id)).toEqual([
      'uncategorized', 'setup', 'shared',
    ]);
  });

  test('includes a multi-category rule in every selected category', () => {
    expect(filterRulesByCategory(rules, 'action_effect_detail').map(({ id }) => id)).toEqual(['shared']);
    expect(filterRulesByCategory(rules, 'flow_endgame_scoring').map(({ id }) => id)).toEqual(['shared']);
  });
});
