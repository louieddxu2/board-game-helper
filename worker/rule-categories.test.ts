import { describe, expect, test } from 'vitest';
import { cleanDetectionKeywords, cleanRuleCategories, parseRuleCategories } from './routes/shared';

describe('rule category persistence', () => {
  test('keeps only supported unique category identifiers', () => {
    expect(cleanRuleCategories([
      'action_effect_detail',
      'unknown',
      'action_effect_detail',
      'flow_endgame_scoring',
    ])).toEqual(['action_effect_detail', 'flow_endgame_scoring']);
  });

  test('treats malformed historical JSON as unclassified', () => {
    expect(parseRuleCategories({ categories_json: '{broken' })).toEqual([]);
  });

  test('normalizes and limits duplicate detection keywords', () => {
    expect(cleanDetectionKeywords([' 勝利點 ', '勝利點', '最高分', 123])).toEqual(['勝利點', '最高分']);
  });
});
