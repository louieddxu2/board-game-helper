import type { HomePayload } from '../shared/types';

export const homeContentKey = (home: HomePayload): string => JSON.stringify({
  featured: (home.featured ?? []).map(({ gameSlug, gameName, ruleId }) => [gameSlug, gameName, ruleId]),
  recentRuleIds: home.recentRuleIds ?? (home.recentRules ?? []).map((rule) => rule.id),
  popularGameIds: home.popularGameIds ?? (home.popularGames ?? []).map((game) => game.id),
  featuredRules: (home.featuredRules ?? []).map((rule) => [rule.id, rule.updatedAt, rule.status, rule.gameId, rule.gameName, rule.gameSlug]),
  recentRules: (home.recentRules ?? []).map((rule) => [rule.id, rule.updatedAt, rule.status, rule.gameId, rule.gameName, rule.gameSlug]),
});
