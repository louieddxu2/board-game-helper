// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildRuleClipboard, copyRuleContent } from './ruleClipboard';
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
    expect(result.text).toBe(`✅ ${rule.statement}\n❌ 不可跳過\n補充說明：只有一次`);
    expect(result.text).not.toContain('玩錯情況');
    expect(result.text).toContain('補充說明：只有一次');
    expect(result.text).not.toContain(url);
    expect(result.html).toBe(`<a href="${url}">✅ 先拿 &lt;2&gt; &amp; &quot;3&quot;<br>再行動<br>❌ 不可跳過<br>補充說明：只有一次</a>`);
    expect(buildRuleClipboard({ ...rule, commonMistake: undefined, details: undefined }, url).text)
      .toBe(`✅ ${rule.statement}`);
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
