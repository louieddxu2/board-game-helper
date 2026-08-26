import type { GameCatalogChange, GameSummary } from '../shared/types';

export const taipeiDateKey = (timestamp = Date.now()): string =>
  new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const normalizeGameSearchText = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('zh-Hant')
  .replace(/[\s\p{P}\p{S}]+/gu, '');

export interface GameCatalogFilterOptions {
  includeGamesWithoutPublishedRules?: boolean;
}

export const filterGameCatalog = (
  games: GameSummary[],
  rawQuery: string,
  limit = 20,
  options: GameCatalogFilterOptions = {},
): GameSummary[] => {
  const query = normalizeGameSearchText(rawQuery);
  if (!query) return [];
  return games
    .filter((game) => options.includeGamesWithoutPublishedRules || (game.publishedRuleCount ?? game.ruleCount) > 0)
    .filter((game) => [game.displayName, game.englishName, ...(game.aliases ?? [])]
      .some((name) => name && normalizeGameSearchText(name).includes(query)))
    .sort((left, right) => {
      const leftExact = [left.displayName, left.englishName, ...(left.aliases ?? [])]
        .some((name) => name && normalizeGameSearchText(name) === query);
      const rightExact = [right.displayName, right.englishName, ...(right.aliases ?? [])]
        .some((name) => name && normalizeGameSearchText(name) === query);
      return Number(rightExact) - Number(leftExact)
        || left.displayName.localeCompare(right.displayName, 'zh-Hant');
    })
    .slice(0, limit);
};

export const upsertGameCatalogEntry = (games: GameSummary[], game: GameSummary): GameSummary[] => {
  const existingIndex = games.findIndex((item) => item.id === game.id);
  if (existingIndex < 0) return [...games, game];
  const updated = [...games];
  updated[existingIndex] = { ...updated[existingIndex], ...game };
  return updated;
};

export const mergeGameCatalogEntries = (base: GameSummary[], overrides: GameSummary[]): GameSummary[] =>
  overrides.reduce((games, override) => {
    const current = games.find((game) => game.id === override.id);
    return current && current.updatedAt > override.updatedAt
      ? games
      : upsertGameCatalogEntry(games, override);
  }, base);

export const applyGameCatalogChanges = (games: GameSummary[], changes: GameCatalogChange[]): GameSummary[] => {
  const byId = new Map(games.map((game) => [game.id, game]));
  for (const change of changes) {
    if (change.deleted) byId.delete(change.gameId);
    else if (change.game) byId.set(change.gameId, change.game);
  }
  return Array.from(byId.values()).sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-Hant'));
};
