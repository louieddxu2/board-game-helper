import { describe, expect, test } from 'vitest';
import { readRuleFilterParams, writeRuleFilterParams } from './ruleFilterParams';

describe('rule filter URL params', () => {
  test('reads repeated values, the legacy comma tag list, and ignores invalid entries', () => {
    expect(readRuleFilterParams(new URLSearchParams('category=nope&tag=設置&tags=計分, 設置&players=2&players=x&players=0&edition=標準版&edition=%20'))).toEqual({
      category: 'all',
      tags: ['設置', '計分'],
      playerCounts: [2],
      editions: ['標準版'],
    });
  });

  test('round-trips every filter and leaves unrelated params alone', () => {
    const written = writeRuleFilterParams(new URLSearchParams('tags=舊&utm=x'), {
      category: 'flow_endgame_scoring', tags: ['A,B', '設置'], playerCounts: [3, 4], editions: ['擴充'], query: '回合',
    });
    expect(written.get('utm')).toBe('x');
    expect(written.has('tags')).toBe(false);
    expect(written.get('find')).toBe('回合');
    expect(readRuleFilterParams(written)).toEqual({
      category: 'flow_endgame_scoring', tags: ['A,B', '設置'], playerCounts: [3, 4], editions: ['擴充'],
    });
  });

  test('removes cleared filters instead of writing empty values', () => {
    const written = writeRuleFilterParams(new URLSearchParams('category=action_effect_detail&tag=a&players=2&edition=e&find=q'), {
      category: 'all', tags: [], playerCounts: [], editions: [], query: '',
    });
    expect(written.toString()).toBe('');
  });
});
