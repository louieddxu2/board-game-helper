import type { FavoriteMutationPayload, PersonalHomeGame, PersonalHomePayload } from '../../src/shared/types';
import type { Database } from './database';

interface FavoriteHomeRow {
  id: string;
  slug: string;
  display_name: string;
  seen_rule_updated_at?: number | null;
  latest_rule_id?: string | null;
  latest_rule_statement?: string | null;
  latest_rule_updated_at?: number | null;
}

const toHomeGame = (row: FavoriteHomeRow, includeUnread: boolean): PersonalHomeGame => ({
  id: row.id,
  slug: row.slug,
  displayName: row.display_name,
  latestRule: row.latest_rule_id && row.latest_rule_statement && row.latest_rule_updated_at
    ? { id: row.latest_rule_id, statement: row.latest_rule_statement, updatedAt: row.latest_rule_updated_at }
    : undefined,
  hasUpdates: includeUnread && Number(row.latest_rule_updated_at ?? 0) > Number(row.seen_rule_updated_at ?? 0),
});

export class FavoriteLimitError extends Error {
  constructor() { super('favorite_limit_reached'); }
}

export const queryPersonalHome = async (db: Database, userId: string): Promise<PersonalHomePayload> => {
  const favoriteResult = await db.statement(`
      SELECT g.id, g.slug, g.display_name, f.seen_rule_updated_at,
        latest.id latest_rule_id, latest.statement latest_rule_statement,
        latest.updated_at latest_rule_updated_at
      FROM user_game_favorites f
      JOIN games g ON g.id = f.game_id AND g.merged_into_game_id IS NULL
      LEFT JOIN rules latest ON latest.id = (
        SELECT r.id FROM rules r
        WHERE r.game_id = g.id AND r.status = 'published'
        ORDER BY r.updated_at DESC, r.id DESC
        LIMIT 1
      )
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC, g.id
      LIMIT 6
    `).bind(userId).all<FavoriteHomeRow>();
  const favorites = (favoriteResult.results ?? []).map((row) => toHomeGame(row, true));
  if (favorites.length === 0) return { favorites: [], recentUpdates: [] };
  const recentResult = await db.statement(`
      WITH ranked AS (
        SELECT r.id, r.game_id, r.statement, r.updated_at,
          ROW_NUMBER() OVER (PARTITION BY r.game_id ORDER BY r.updated_at DESC, r.id DESC) position
        FROM rules r
        WHERE r.status = 'published'
      )
      SELECT g.id, g.slug, g.display_name,
        ranked.id latest_rule_id, ranked.statement latest_rule_statement,
        ranked.updated_at latest_rule_updated_at
      FROM ranked
      JOIN games g ON g.id = ranked.game_id AND g.merged_into_game_id IS NULL
      WHERE ranked.position = 1
      ORDER BY ranked.updated_at DESC, ranked.id DESC
      LIMIT 6
    `).all<FavoriteHomeRow>();
  return {
    favorites,
    recentUpdates: (recentResult.results ?? []).map((row) => toHomeGame(row, false)),
  };
};

const favoriteCount = async (db: Database, userId: string) => Number((await db.statement(
  'SELECT COUNT(*) count FROM user_game_favorites WHERE user_id = ?',
).bind(userId).first<{ count: number }>())?.count ?? 0);

export const queryFavoriteStatus = async (db: Database, userId: string, gameId: string) => {
  const [favorite, count] = await Promise.all([
    db.statement('SELECT 1 favorite FROM user_game_favorites WHERE user_id = ? AND game_id = ?')
      .bind(userId, gameId).first<{ favorite: number }>(),
    favoriteCount(db, userId),
  ]);
  return { favorite: Boolean(favorite), favoriteCount: count };
};

export const addFavorite = async (db: Database, userId: string, gameId: string, timestamp: number): Promise<FavoriteMutationPayload> => {
  const game = await db.statement(`
    SELECT g.id, COALESCE((
      SELECT MAX(r.updated_at) FROM rules r WHERE r.game_id = g.id AND r.status = 'published'
    ), 0) current_version
    FROM games g WHERE g.id = ? AND g.merged_into_game_id IS NULL
  `).bind(gameId).first<{ id: string; current_version: number }>();
  if (!game) throw new Error('game_not_found');
  const current = await queryFavoriteStatus(db, userId, gameId);
  if (current.favorite) return current;
  if (current.favoriteCount >= 6) throw new FavoriteLimitError();
  try {
    await db.statement(`
      INSERT INTO user_game_favorites (user_id, game_id, seen_rule_updated_at, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(userId, gameId, game.current_version, timestamp).run();
  } catch (error) {
    if (String(error).includes('favorite_limit_reached')) throw new FavoriteLimitError();
    throw error;
  }
  return { favorite: true, favoriteCount: current.favoriteCount + 1, wasFirst: current.favoriteCount === 0 };
};

export const removeFavorite = async (db: Database, userId: string, gameId: string): Promise<FavoriteMutationPayload> => {
  await db.statement('DELETE FROM user_game_favorites WHERE user_id = ? AND game_id = ?').bind(userId, gameId).run();
  return { favorite: false, favoriteCount: await favoriteCount(db, userId) };
};

export const clearFavorites = async (db: Database, userId: string): Promise<FavoriteMutationPayload> => {
  await db.statement('DELETE FROM user_game_favorites WHERE user_id = ?').bind(userId).run();
  return { favorite: false, favoriteCount: 0 };
};

export const markFavoriteSeen = async (db: Database, userId: string, gameId: string) => {
  await db.statement(`
    UPDATE user_game_favorites
    SET seen_rule_updated_at = COALESCE((
      SELECT MAX(r.updated_at) FROM rules r WHERE r.game_id = ? AND r.status = 'published'
    ), 0)
    WHERE user_id = ? AND game_id = ?
  `).bind(gameId, userId, gameId).run();
  return { ok: true as const };
};
