import { expect, test } from 'vitest';
import type { UncertainRule } from '../shared/types';
import { buildUncertainRuleAiPrompt, buildUncertainRulePost } from './uncertainRulePost';

const rule = (question: string, extra: Partial<UncertainRule> = {}): UncertainRule => ({
  id: question, gameId: 'g', question, checkedAt: 1, createdAt: 1, updatedAt: 1, ...extra,
});
const game = { displayName: '柏林咖啡館', englishName: 'Seize the Bean' };

test('several questions become one numbered post under the English name', () => {
  expect(buildUncertainRulePost(game, [rule('能啟動兩次嗎？', { tableRuling: '不行' }), rule('平手怎麼算？')])).toBe([
    'Title: Rules questions about Seize the Bean',
    '',
    'Hi all, we ran into these rules questions while playing Seize the Bean.',
    'We checked the rulebook and the forums but could not find an answer.',
    '',
    'Q1. 能啟動兩次嗎？',
    'How we played it for now: 不行',
    '',
    'Q2. 平手怎麼算？',
    '',
    'Thanks for any help!',
  ].join('\n'));
});

test('a single question is unnumbered and claims no search when it was not looked up', () => {
  const post = buildUncertainRulePost({ displayName: '柏林咖啡館' }, [rule('平手怎麼算？', { checkedAt: null })]);
  expect(post).toContain('Title: Rules question about 柏林咖啡館');
  expect(post).toContain('\nQ. 平手怎麼算？');
  expect(post).not.toContain('We checked');
});

test('the AI copy leads the same post with a translation instruction', () => {
  const rules = [rule('平手怎麼算？')];
  const prompt = buildUncertainRuleAiPrompt(game, rules);
  expect(prompt.startsWith('請把下面這篇 BoardGameGeek 規則提問翻成自然的英文。')).toBe(true);
  expect(prompt.endsWith(buildUncertainRulePost(game, rules))).toBe(true);
});
