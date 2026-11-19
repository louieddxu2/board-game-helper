// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildRuleClipboard, buildRuleShareText, copyRuleContent } from './ruleClipboard';
import type { RuleCard } from '../shared/types';

const rule: RuleCard = {
  id: 'rule_1', gameId: 'game_1', statement: '先拿 <2> & "3"\n再行動',
  commonMistake: '不可跳過', details: '只有一次', status: 'published', tags: [], sourceLinks: [],
};
const url = 'https://example.com/games/test#rule-rule_1';
afterEach(() => vi.unstubAllGlobals());

describe('rule clipboard', () => {
  test('copies readable body text and escaped HTML with a rule permalink and line breaks', () => {
    const result = buildRuleClipboard(rule, url);
    expect(result.text).toBe(`✅ ${rule.statement}\n❌ 不可跳過\n🔍 只有一次`);
    const link = (text: string) => `<a href="${url}">${text}</a>`;
    expect(result.html).toBe([
      '✅ 先拿 &lt;2&gt; &amp; &quot;3&quot;', '再行動', '❌ 不可跳過', '🔍 只有一次',
    ].map(link).join('<br>'));
    expect(result.html).not.toContain('<p>');
    expect(buildRuleClipboard({ ...rule, commonMistake: undefined, details: undefined }, url).text)
      .toBe(`✅ ${rule.statement}`);
  });

  test('leads the copy with the game name and keeps every line break outside the links', () => {
    const result = buildRuleClipboard({ ...rule, details: '第一行\n\n第三行' }, url, ' 測試遊戲 ');
    expect(result.text).toBe(`測試遊戲\n✅ ${rule.statement}\n❌ 不可跳過\n🔍 第一行\n\n第三行`);
    expect(result.html.startsWith(`<a href="${url}">測試遊戲</a><br>`)).toBe(true);
    expect(result.html).toContain(`<a href="${url}">🔍 第一行</a><br><br><a href="${url}">第三行</a>`);
    expect(result.html).not.toMatch(/<a [^>]*>[^<]*<br>/);
  });

  test('shares the same body as the copy, led by the game name when known', () => {
    expect(buildRuleShareText(rule, ' 測試遊戲 ')).toBe(buildRuleClipboard(rule, url, '測試遊戲').text);
    expect(buildRuleShareText(rule, ' 測試遊戲 ')).toBe(`測試遊戲\n${buildRuleClipboard(rule, url).text}`);
    expect(buildRuleShareText(rule)).toBe(buildRuleClipboard(rule, url).text);
  });

  test('writes plain text and HTML together in one clipboard item', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    class Item {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', Item);
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    await expect(copyRuleContent(rule, url)).resolves.toBe('rich');
    expect(write).toHaveBeenCalledTimes(1);
    const [item] = write.mock.calls[0][0] as Item[];
    expect(await item.data['text/plain'].text()).toBe(buildRuleClipboard(rule, url).text);
    expect(await item.data['text/html'].text()).toBe(buildRuleClipboard(rule, url).html);
    expect(writeText).not.toHaveBeenCalled();
  });

  test.each([false, true])('falls back to text when rich clipboard is unavailable or rejected: %s', async (reject) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('ClipboardItem', reject ? class {} : undefined);
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn().mockRejectedValue(new Error('unsupported')), writeText } });
    await expect(copyRuleContent(rule, url)).resolves.toBe('plain');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(buildRuleClipboard(rule, url).text);
  });

  test('reports clipboard denial to the caller', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await expect(copyRuleContent(rule, url)).rejects.toThrow('denied');
  });
});
