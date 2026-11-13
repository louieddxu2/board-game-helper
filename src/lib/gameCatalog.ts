import type { GameCatalogChange, GameSummary } from '../shared/types';
import { normalizeName as normalizeGameSearchText } from '../shared/nameNormalization';
export { normalizeGameSearchText };

export const taipeiDateKey = (timestamp = Date.now()): string =>
  new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

export interface GameCatalogFilterOptions {
  includeGamesWithoutPublishedRules?: boolean;
}

/** On the rules site only a base game is a game unit; expansions and versions belong to one. */
export const isStandaloneGame = (game: Pick<GameSummary, 'entityKind'>): boolean =>
  !game.entityKind || game.entityKind === 'base';

const gameNames = (game: GameSummary) => [game.displayName, game.englishName, ...(game.aliases ?? [])];

export const filterGameCatalog = (
  games: GameSummary[],
  rawQuery: string,
  limit = 20,
  options: GameCatalogFilterOptions = {},
): GameSummary[] => {
  const query = normalizeGameSearchText(rawQuery);
  if (!query) return [];
  const byId = new Map(games.map((game) => [game.id, game]));
  const matches = new Map<string, { game: GameSummary; exact: boolean; direct: boolean; variantName?: string }>();
  for (const game of games) {
    const names = gameNames(game).filter((name): name is string => Boolean(name)).map(normalizeGameSearchText);
    if (!names.some((name) => name.includes(query))) continue;
    // An expansion name finds the base game it belongs to, never a separate game.
    const direct = isStandaloneGame(game);
    const target = direct ? game : byId.get(game.parentGameId ?? '');
    if (!target || !isStandaloneGame(target)) continue;
    if (!options.includeGamesWithoutPublishedRules && (target.publishedRuleCount ?? target.ruleCount) <= 0) continue;
    const match = matches.get(target.id) ?? { game: target, exact: false, direct: false };
    match.exact ||= names.includes(query);
    match.direct ||= direct;
    if (!direct) match.variantName ??= game.displayName;
    matches.set(target.id, match);
  }
  return Array.from(matches.values())
    .sort((left, right) => Number(right.exact) - Number(left.exact)
      || left.game.displayName.localeCompare(right.game.displayName, 'zh-Hant'))
    .slice(0, limit)
    // A direct hit on the base game needs no expansion hint.
    .map(({ game, direct, variantName }) => direct || !variantName ? game : { ...game, matchedVariantName: variantName });
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
