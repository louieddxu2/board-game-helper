import { describe, expect, test } from 'vitest';
import { closestDraft, ruleTextSimilarity, SIMILAR_RULE_THRESHOLD } from './ruleSimilarity';

describe('rule similarity', () => {
  test('scores the same rule written with different punctuation, spacing and width as identical', () => {
    expect(ruleTextSimilarity('起始有的那片 Town Hall 不算是城市（city）。', '起始有的那片TownHall不算是城市(CITY)')).toBe(1);
  });

  test('flags a reworded duplicate but not an unrelated rule of the same game', () => {
    const existing = '起始有的那片Town Hall不算是城市(city)（不算入某些以城市為目標的計分條件）';
    expect(ruleTextSimilarity(existing, '起始那片 Town Hall 不算城市，不計入城市目標')).toBeGreaterThanOrEqual(SIMILAR_RULE_THRESHOLD);
    expect(ruleTextSimilarity(existing, '船隻移動時不能穿越其他玩家的船。')).toBeLessThan(SIMILAR_RULE_THRESHOLD);
  });

  test('points at the closest draft, ignores drafts too short to compare, and adds a little for a shared tag', () => {
    const drafts = [{ statement: '甲', tags: [] }, { statement: '大教堂只能蓋在自己城市旁', tags: ['建造'] }];
    const match = closestDraft('大教堂只能蓋在自己的城市旁邊', ['建造'], drafts);
    expect(match?.draftIndex).toBe(1);
    const withoutTag = closestDraft('大教堂只能蓋在自己的城市旁邊', [], drafts);
    expect(match!.score).toBeCloseTo(withoutTag!.score + 0.05, 5);
    expect(closestDraft('完全不同的規則內容', [], drafts)).toBeUndefined();
  });
});
