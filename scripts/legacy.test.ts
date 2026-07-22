import { describe, expect, test } from 'vitest';
import { allUrls, canonicalLegacyGameName, chooseFlowStage, legacyGameAliases, normalizeLegacyName, parseDeclaredCount, prepareLegacyRules, splitLegacyRules, sqlValue } from './legacy';

describe('legacy import helpers', () => {
  test('normalizes full width characters, spaces and punctuation', () => {
    expect(normalizeLegacyName(' Smartphone Inc. 手機帝國 ')).toBe('smartphoneinc手機帝國');
    expect(normalizeLegacyName('ＡＢＣ－１２３')).toBe('abc123');
  });

  test('splits newline and numbered rules without losing prose', () => {
    expect(splitLegacyRules('1. 起始有三元\n2、結束時三個資源一分\n\n- 可以暗抽')).toEqual([
      '起始有三元', '結束時三個資源一分', '可以暗抽',
    ]);
  });

  test('maps the coarse legacy category conservatively', () => {
    expect(chooseFlowStage('起始設置, 機制')).toBe('uncategorized');
    expect(chooseFlowStage('計分')).toBe('end_scoring');
    expect(chooseFlowStage('機制')).toBe('uncategorized');
  });

  test('preserves every source URL', () => {
    expect(allUrls('note\nhttps://example.com/a\nhttps://example.com/b')).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  test('keeps known explanatory paragraphs with one legacy rule', () => {
    const rules = prepareLegacyRules({ rowNumber: 8, timestamp: '', timestampMs: 0, gameName: 'test', ruleText: '規則結論\n補充推論', category: '機制', sourceLabel: '', sourceUrl: '' });
    expect(rules).toEqual([{ statement: '規則結論', details: '補充推論', flowStage: 'uncategorized' }]);
  });

  test('uses audited per-rule stages and canonical aliases', () => {
    const rules = prepareLegacyRules({ rowNumber: 2, timestamp: '', timestampMs: 0, gameName: 'test', ruleText: '一\n二\n三\n四', category: '起始設置,計分,機制', sourceLabel: '', sourceUrl: '' });
    expect(rules.map((rule) => rule.flowStage)).toEqual(['setup', 'setup', 'end_scoring', 'action']);
    expect(canonicalLegacyGameName('氣笛山脈')).toBe('Whistle Mountain 汽笛山脈');
    expect(legacyGameAliases('氣笛山脈')).toEqual(expect.arrayContaining(['氣笛山脈', 'Whistle Mountain 汽笛山脈', 'Whistle Mountain', '汽笛山脈']));
  });

  test('reads full-width and approximate declared counts', () => {
    expect(parseDeclaredCount('３')).toBe(3);
    expect(parseDeclaredCount('5+')).toBe(5);
  });

  test('escapes SQL text', () => {
    expect(sqlValue("player's rule")).toBe("'player''s rule'");
    expect(sqlValue('')).toBe('NULL');
  });
});
