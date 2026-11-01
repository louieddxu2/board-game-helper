import { expect, test } from 'vitest';
import type { GameDetail, RuleCard } from '../shared/types';
import { canonicalGameUrl, gameDescription, gameTitle, shouldIndexGame } from './gameSeo';

const rule = (tags: string[]) => ({ tags: tags.map((name, index) => ({ id: `${name}-${index}`, name })) }) as unknown as RuleCard;
const game = (overrides: Partial<GameDetail> = {}): GameDetail => ({
  id: 'g1', slug: '姬路城', displayName: '姬路城', englishName: 'The White Castle', aliases: [], ruleCount: 3, updatedAt: 1,
  rules: [rule(['計分', '設置']), rule(['計分']), rule([])],
  ...overrides,
});

test('titles the game with its rule count and describes only its most common topics', () => {
  expect(gameTitle(game())).toBe('姬路城：玩錯的3條規則');
  expect(gameDescription(game())).toBe('計分、設置');
});

test('leaves the description to the site default when rules have no resolved tags', () => {
  const rules = [{ tags: [{ id: 'x', name: '待確認', unresolved: true }] }] as unknown as RuleCard[];
  expect(gameDescription(game({ rules, ruleCount: 1 }))).toBeUndefined();
});

test('keeps games without published rules out of search results', () => {
  const empty = game({ rules: [], ruleCount: 0, publishedRuleCount: 0 });
  expect(shouldIndexGame(empty)).toBe(false);
  expect(shouldIndexGame(game())).toBe(true);
});

test('points every filtered view of a game at one canonical URL', () => {
  expect(canonicalGameUrl('https://rules.example', game())).toBe('https://rules.example/games/%E5%A7%AC%E8%B7%AF%E5%9F%8E');
});
