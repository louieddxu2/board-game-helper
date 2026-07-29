import { describe, expect, test } from 'vitest';
import type { RuleCard } from '../shared/types';
import { detectAutomaticRuleCategories, filterRulesByCategory } from './ruleCategories';

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

  test('automatically classifies an unclassified rule from configured keywords', () => {
    const publicTags = [{
      id: 'tag-scoring',
      slug: 'scoring',
      name: '計分',
      categoryHints: ['flow_endgame_scoring' as const],
      detectionKeywords: ['勝利點', '最高分'],
    }];
    const unclassified = { ...rule('auto'), statement: '遊戲結束時，勝利點最高者獲勝。' };

    expect(detectAutomaticRuleCategories(unclassified, publicTags)).toEqual(['flow_endgame_scoring']);
    expect(filterRulesByCategory([unclassified], 'flow_endgame_scoring', publicTags)).toHaveLength(1);
  });

  test('manual categories completely override automatic matches', () => {
    const publicTags = [{
      id: 'tag-scoring',
      slug: 'scoring',
      name: '計分',
      categoryHints: ['flow_endgame_scoring' as const],
      detectionKeywords: ['勝利點'],
    }];
    const manuallyClassified = {
      ...rule('manual', ['action_effect_detail']),
      statement: '這個行動可以取得勝利點。',
    };

    expect(detectAutomaticRuleCategories(manuallyClassified, publicTags)).toEqual([]);
    expect(filterRulesByCategory([manuallyClassified], 'flow_endgame_scoring', publicTags)).toHaveLength(0);
    expect(filterRulesByCategory([manuallyClassified], 'action_effect_detail', publicTags)).toHaveLength(1);
  });

  test('uses category hints from an assigned tag only when the rule is unclassified', () => {
    const tagged = {
      ...rule('tagged'),
      tags: [{ id: 'tag-action', slug: 'action', name: '行動', categoryHints: ['action_effect_detail' as const] }],
    };
    expect(detectAutomaticRuleCategories(tagged, [])).toEqual(['action_effect_detail']);
  });
});
