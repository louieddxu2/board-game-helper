import { expect, test } from 'vitest';
import type { GameDetail, RuleCard } from '../shared/types';
import { canonicalGameUrl, gameDescription, shouldIndexGame } from './gameSeo';

const rule = (tags: string[]) => ({ tags: tags.map((name, index) => ({ id: `${name}-${index}`, name })) }) as unknown as RuleCard;
const game = (overrides: Partial<GameDetail> = {}): GameDetail => ({
  id: 'g1', slug: '姬路城', displayName: '姬路城', englishName: 'The White Castle', aliases: [], ruleCount: 3, updatedAt: 1,
  rules: [rule(['計分', '設置']), rule(['計分']), rule([])],
  ...overrides,
});

test('describes the game with its rule count and most common topics', () => {
  expect(gameDescription(game())).toBe('姬路城（The White Castle）：3 條容易玩錯的規則，涉及計分、設置。');
});

test('omits topics when rules have no tags and skips unresolved tags', () => {
  const rules = [{ tags: [{ id: 'x', name: '待確認', unresolved: true }] }] as unknown as RuleCard[];
  expect(gameDescription(game({ englishName: undefined, rules, ruleCount: 1 }))).toBe('姬路城：1 條容易玩錯的規則。');
});

test('states plainly when a game has no rules yet and keeps it out of search results', () => {
  const empty = game({ rules: [], ruleCount: 0, publishedRuleCount: 0 });
  expect(gameDescription(empty)).toBe('姬路城（The White Castle）：目前還沒有玩錯規則的紀錄。');
  expect(shouldIndexGame(empty)).toBe(false);
  expect(shouldIndexGame(game())).toBe(true);
});

test('points every filtered view of a game at one canonical URL', () => {
  expect(canonicalGameUrl('https://rules.example', game())).toBe('https://rules.example/games/%E5%A7%AC%E8%B7%AF%E5%9F%8E');
});
