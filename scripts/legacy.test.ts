import { describe, expect, test } from 'vitest';
import { chooseFlowStage, firstUrl, normalizeLegacyName, parseDeclaredCount, splitLegacyRules, sqlValue } from './legacy';

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
    expect(chooseFlowStage('起始設置, 機制')).toBe('setup');
    expect(chooseFlowStage('計分')).toBe('end_scoring');
    expect(chooseFlowStage('機制')).toBe('uncategorized');
  });

  test('keeps only first URL for the public submission source', () => {
    expect(firstUrl('note\nhttps://example.com/a\nhttps://example.com/b')).toBe('https://example.com/a');
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
