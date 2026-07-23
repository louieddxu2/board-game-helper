import { describe, it, expect } from 'vitest';
import { detectDeterministicTags, DetectionContext, DetectionInput } from './tagDetector';

describe('detectDeterministicTags', () => {
  it('1. 精確文字包含：文字包含「魔術師」，gameTags 包含 魔術師 ➡️ 被偵測出', () => {
    const context: DetectionContext = {
      gameTags: [{ name: '魔術師' }],
    };
    const input: DetectionInput = {
      statement: '我打出魔術師這張牌',
    };
    const result = detectDeterministicTags(input, context);
    expect(result).toContain('魔術師');
  });

  it('2. 文字不包含：文字包含「魔法師」，gameTags 包含 魔術師 ➡️ 不被偵測出（不做模糊猜測）', () => {
    const context: DetectionContext = {
      gameTags: [{ name: '魔術師' }],
    };
    const input: DetectionInput = {
      statement: '我打出魔法師這張牌',
    };
    const result = detectDeterministicTags(input, context);
    expect(result).not.toContain('魔術師');
  });

  it('3. 別名匹配：文字包含「補牌」，gameTags 包含 name: "抽牌", aliases: ["補牌"] ➡️ 偵測出 抽牌', () => {
    const context: DetectionContext = {
      gameTags: [{ name: '抽牌', aliases: ['補牌'] }],
    };
    const input: DetectionInput = {
      details: '這回合可以補牌嗎？',
    };
    const result = detectDeterministicTags(input, context);
    expect(result).toContain('抽牌');
  });

  it('4. 已選擇過濾：當 currentSelectedTags 已包含 魔術師 時，不重複回傳 魔術師', () => {
    const context: DetectionContext = {
      gameTags: [{ name: '魔術師' }],
    };
    const input: DetectionInput = {
      statement: '我打出魔術師這張牌',
    };
    const currentSelectedTags = ['魔術師'];
    const result = detectDeterministicTags(input, context, currentSelectedTags);
    expect(result).not.toContain('魔術師');
  });

  it('5. 脈絡繼承：傳入 inheritedTags: ["學院擴充"] ➡️ 回傳包含 學院擴充', () => {
    const context: DetectionContext = {
      gameTags: [{ name: '魔術師' }],
      inheritedTags: ['學院擴充'],
    };
    const input: DetectionInput = {
      statement: '',
    };
    const result = detectDeterministicTags(input, context);
    expect(result).toContain('學院擴充');
  });
});
