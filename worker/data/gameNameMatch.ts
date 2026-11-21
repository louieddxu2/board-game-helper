import { normalizeName } from '../../src/shared/nameNormalization';
import type { Database } from './database';

export interface NamedGame {
  id: string;
  slug: string;
}

// An OR across games and their aliases scans every game. Bind the normalized
// name twice: each branch searches its own index.
const EXACT_GAME_NAME_IDS = `
  SELECT id FROM games INDEXED BY idx_games_normalized_name WHERE normalized_name = ?
  UNION
  SELECT game_id FROM game_aliases INDEXED BY idx_game_aliases_search WHERE normalized_alias = ?
`;

/**
 * Find the public game a new-game submission already names by its stored name or an alias,
 * using only indexed lookups. The record page matches a typed name against the local catalog,
 * English names included, before it submits, so it sends the existing game's id; this check
 * only covers what the page could not, without reading the whole catalog on the server.
 */
export const findGameByRequestedName = async (
  db: Database,
  names: Array<string | undefined>,
): Promise<NamedGame | null> => {
  const keys = Array.from(new Set(names.map((name) => (name ? normalizeName(name) : '')).filter(Boolean)));
  for (const key of keys) {
    const game = await db.statement(`
      SELECT g.id, g.slug FROM games g INDEXED BY sqlite_autoindex_games_1
      WHERE g.merged_into_game_id IS NULL AND g.visibility = 'public'
        AND g.id IN (${EXACT_GAME_NAME_IDS})
      LIMIT 1
    `).bind(key, key).first<NamedGame>();
    if (game) return game;
  }
  return null;
};
