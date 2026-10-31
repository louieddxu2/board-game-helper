import type { GameDetail } from '../shared/types';

export const SITE_TITLE = '玩錯的桌遊規則';

const publishedRuleCount = (game: GameDetail) => game.publishedRuleCount ?? game.rules.length;

// Plain facts only: the name, how many rules exist, and their most common topics.
export const gameDescription = (game: GameDetail) => {
  const name = game.englishName && game.englishName !== game.displayName
    ? `${game.displayName}（${game.englishName}）`
    : game.displayName;
  const count = publishedRuleCount(game);
  if (count === 0) return `${name}：目前還沒有玩錯規則的紀錄。`;
  const tagCounts = new Map<string, number>();
  game.rules.forEach((rule) => rule.tags?.forEach((tag) => {
    if (!tag.unresolved) tagCounts.set(tag.name, (tagCounts.get(tag.name) ?? 0) + 1);
  }));
  const topics = [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tagName]) => tagName);
  return `${name}：${count} 條容易玩錯的規則${topics.length ? `，涉及${topics.join('、')}` : ''}。`;
};

// Games without published rules have nothing to find, so search engines should skip them.
export const shouldIndexGame = (game: GameDetail) => publishedRuleCount(game) > 0;

export const canonicalGameUrl = (origin: string, game: Pick<GameDetail, 'slug'>) =>
  `${origin}/games/${encodeURIComponent(game.slug)}`;
