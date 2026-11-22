import { describe, expect, test } from 'vitest';
import { closestDraft, draftCoverage, SIMILAR_RULE_THRESHOLD } from './ruleSimilarity';

const rule = (statement: string, extra: { commonMistake?: string; details?: string; tags?: string[] } = {}) =>
  ({ statement, tags: [], ...extra });
const draft = (statement: string, tags: string[] = []) => ({ statement, tags });

describe('rule similarity', () => {
  test('ignores punctuation, spacing, width and case', () => {
    expect(draftCoverage('起始有的那片 Town Hall 不算是城市（city）。', '起始有的那片TownHall不算是城市(CITY)')).toBe(1);
  });

  test('flags a shorter, reworded draft that the current Dice comparison missed, but not an unrelated rule', () => {
    const existing = rule('紳士魔術師放置在工作室時不會獲得分數。(要放在市區、市場、黑街才會加分)');
    expect(closestDraft(existing, [draft('紳士放在工作室沒有分數')])).toMatchObject({ draftIndex: 0, similar: true });
    const unrelated = closestDraft(rule('2 人遊戲時，玩家順位標記只會放在 1 跟 3 位置。'), [draft('紳士放在工作室沒有分數')]);
    expect(unrelated!.score).toBeLessThan(SIMILAR_RULE_THRESHOLD);
    expect(unrelated!.similar).toBe(false);
  });

  test('scores below the flag still order the right rule first', () => {
    const drafted = [draft('沒有派遣出去的人不用付薪水')];
    const target = closestDraft(rule('未派遣的閒置人員不需為其支付薪水，且其下的特殊派遣卡會回到玩家手中。'), drafted)!;
    const other = closestDraft(rule('每次派遣一個人去學院的行動中，最多只能教授你的每個戲法各一次。'), drafted)!;
    expect(target.similar).toBe(false);
    expect(target.score).toBeGreaterThan(other.score);
  });

  test('matches a draft against the mistake or notes on their own, so long notes do not dilute the statement', () => {
    const existing = rule('起始玩家先行動。', { commonMistake: '以為兩人局的順位標記放在第一和第二格', details: '這是很長的補充說明，'.repeat(10) });
    expect(closestDraft(existing, [draft('兩人局的順位標記放在第一和第二格')])).toMatchObject({ similar: true });
  });

  test('points at the closest draft, adds a little for a shared tag, and never flags a draft too short to compare', () => {
    const existing = rule('大教堂只能蓋在自己的城市旁邊', { tags: ['建造'] });
    const drafts = [draft('甲'), draft('大教堂只能蓋在自己城市旁', ['建造'])];
    const match = closestDraft(existing, drafts)!;
    expect(match.draftIndex).toBe(1);
    const withoutTag = closestDraft({ ...existing, tags: [] }, drafts)!;
    expect(match.score).toBeCloseTo(withoutTag.score + 0.05, 5);
    expect(closestDraft(existing, [draft('城市')])).toMatchObject({ score: 1, similar: false });
    expect(closestDraft(existing, [draft('')])).toBeUndefined();
  });
});
