import type { GameDetail } from '../shared/types';

export const SITE_TITLE = '玩錯的桌遊規則';

const publishedRuleCount = (game: GameDetail) => game.publishedRuleCount ?? game.rules.length;

// Only games with published rules belong in search results.
export const shouldIndexGame = (game: GameDetail) => publishedRuleCount(game) > 0;

export const gameTitle = (game: GameDetail) => `${game.displayName}：玩錯的${publishedRuleCount(game)}條規則`;

// The title carries the name and count, so the description lists only the main topics, if any.
export const gameDescription = (game: GameDetail) => {
  const tagCounts = new Map<string, number>();
  game.rules.forEach((rule) => rule.tags?.forEach((tag) => {
    if (!tag.unresolved) tagCounts.set(tag.name, (tagCounts.get(tag.name) ?? 0) + 1);
  }));
  const topics = [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tagName]) => tagName);
  return topics.length ? topics.join('、') : undefined;
};

export const canonicalGameUrl = (origin: string, game: Pick<GameDetail, 'slug'>) =>
  `${origin}/games/${encodeURIComponent(game.slug)}`;
