import type { GameDetail } from '../shared/types';

export const SITE_TITLE = '玩錯的桌遊規則';

const publishedRuleCount = (game: GameDetail) => game.publishedRuleCount ?? game.rules.length;

// Only games with published rules belong in search results.
export const shouldIndexGame = (game: GameDetail) => publishedRuleCount(game) > 0;

export const gameTitle = (game: GameDetail) => `${game.displayName}：玩錯的${publishedRuleCount(game)}條規則`;

const DESCRIPTION_LIMIT = 100;

// The title carries the name and count. One rule is shown as written, up to the limit;
// several rules are summarized by their main topics, if any.
export const gameDescription = (game: GameDetail) => {
  if (publishedRuleCount(game) === 1 && game.rules[0]?.statement) {
    const text = Array.from(game.rules[0].statement.replace(/\s+/g, ' ').trim());
    return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1).join('')}…` : text.join('');
  }
  const tagCounts = new Map<string, number>();
  game.rules.forEach((rule) => rule.tags?.forEach((tag) => {
    if (!tag.unresolved) tagCounts.set(tag.name, (tagCounts.get(tag.name) ?? 0) + 1);
  }));
  const topics = [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tagName]) => tagName);
  return topics.length ? `關於：${topics.join('、')}` : undefined;
};

export const canonicalGameUrl = (origin: string, game: Pick<GameDetail, 'slug'>) =>
  `${origin}/games/${encodeURIComponent(game.slug)}`;
