import type { HomePayload } from '../shared/types';

export const homeContentKey = (home: HomePayload): string => JSON.stringify({
  featured: (home.featured ?? []).map(({ gameSlug, gameName, ruleId }) => [gameSlug, gameName, ruleId]),
  recentRuleIds: home.recentRuleIds ?? (home.recentRules ?? []).map((rule) => rule.id),
  popularGameIds: home.popularGameIds ?? (home.popularGames ?? []).map((game) => game.id),
});
