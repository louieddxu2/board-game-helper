import type { Database } from './database';

// Read-only game data for the score pad Worker, reached only through the
// ScorepadApi Service Binding entrypoint. Every method issues one D1 query,
// whatever the list or page size, to stay within the free plan's limits.

export const SCOREPAD_BGG_LOOKUP_LIMIT = 100;
export const SCOREPAD_CHANGES_PAGE_LIMIT = 200;

export interface ScorepadGame {
  bggId: string;
  gameId: string;
  displayName: string;
  englishName: string | null;
  aliases: string[];
}

export interface ScorepadGameChange {
  gameId: string;
  catalogVersion: number;
  bggIds: string[];
  deleted: boolean;
  displayName?: string;
  englishName?: string | null;
  aliases?: string[];
}

export interface ScorepadGameChanges {
  changes: ScorepadGameChange[];
  throughVersion: number;
  hasMore: boolean;
}

// A game the score pad may show: public, not merged away and not awaiting review.
const LISTED = (alias: string) => `${alias}.visibility = 'public'
  AND ${alias}.merged_into_game_id IS NULL
  AND ${alias}.review_status <> 'pending'`;

const ALIASES = (alias: string) => `COALESCE((
    SELECT json_group_array(alias) FROM (
      SELECT alias FROM game_aliases INDEXED BY idx_game_aliases_unique
      WHERE game_id = ${alias}.id ORDER BY alias
    )
  ), '[]')`;

const BGG_ID = /^[1-9]\d{0,9}$/;

const parseStrings = (json: string | null): string[] => {
  const parsed: unknown = JSON.parse(json ?? '[]');
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
};

export const normalizeBggIds = (bggIds: unknown): string[] => {
  if (!Array.isArray(bggIds)) throw new TypeError('scorepad_bgg_ids_must_be_an_array');
  if (bggIds.length > SCOREPAD_BGG_LOOKUP_LIMIT) throw new RangeError(`scorepad_bgg_ids_limit_${SCOREPAD_BGG_LOOKUP_LIMIT}`);
  const ids = bggIds.map((id) => (typeof id === 'string' ? id.trim() : ''));
  if (ids.some((id) => !BGG_ID.test(id))) throw new TypeError('scorepad_bgg_id_must_be_a_positive_integer_string');
  return [...new Set(ids)];
};

// BGG ids live in games.bgg_id (integer) and game_external_ids (text, any
// relation). The requested list drives both lookups through json_each and
// CROSS JOIN; an IN (...) list of this size makes SQLite scan the id table.
export const lookupScorepadGamesByBgg = async (db: Database, bggIds: unknown): Promise<ScorepadGame[]> => {
  const ids = normalizeBggIds(bggIds);
  if (!ids.length) return [];
  const result = await db.statement(`
    WITH requested(bgg_id) AS (SELECT value FROM json_each(?)),
    matched(bgg_id, game_id) AS (
      SELECT requested.bgg_id, g.id
      FROM requested
      CROSS JOIN games g INDEXED BY idx_games_bgg_id ON g.bgg_id = CAST(requested.bgg_id AS INTEGER)
      UNION
      SELECT requested.bgg_id, external.game_id
      FROM requested
      CROSS JOIN game_external_ids external INDEXED BY sqlite_autoindex_game_external_ids_2
        ON external.source = 'bgg' AND external.external_id = requested.bgg_id
    )
    SELECT matched.bgg_id, g.id AS game_id, g.display_name, g.english_name, ${ALIASES('g')} AS aliases_json
    FROM matched
    CROSS JOIN games g INDEXED BY sqlite_autoindex_games_1 ON g.id = matched.game_id
    WHERE ${LISTED('g')}
    ORDER BY matched.bgg_id, g.id
  `).bind(JSON.stringify(ids)).all<{
    bgg_id: string; game_id: string; display_name: string; english_name: string | null; aliases_json: string;
  }>();
  return (result.results ?? []).map((row) => ({
    bggId: String(row.bgg_id),
    gameId: row.game_id,
    displayName: row.display_name,
    englishName: row.english_name ?? null,
    aliases: parseStrings(row.aliases_json),
  }));
};

export const currentScorepadCatalogVersion = async (db: Database): Promise<number> => {
  const row = await db.statement('SELECT current_version FROM game_catalog_clock WHERE id = 1')
    .first<{ current_version: number }>();
  if (!row) throw new Error('game_catalog_clock_unavailable');
  return Number(row.current_version);
};

const validInteger = (value: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`scorepad_${name}_must_be_an_integer_from_${min}_to_${max}`);
  }
  return value;
};

// Pages game_catalog_entries by catalog_version, the same cursor as the public
// catalog. The current game row decides visibility, so hidden, pending,
// merged and removed games come back as deleted. The page drives every lookup.
export const listScorepadGameChangesSince = async (
  db: Database,
  afterVersion: unknown,
  limit: unknown,
): Promise<ScorepadGameChanges> => {
  const after = validInteger(afterVersion, 'after_version', 0);
  const size = validInteger(limit, 'limit', 1, SCOREPAD_CHANGES_PAGE_LIMIT);
  const result = await db.statement(`
    WITH page AS (
      SELECT game_id, catalog_version
      FROM game_catalog_entries INDEXED BY idx_game_catalog_entries_version
      WHERE catalog_version > ?
      ORDER BY catalog_version, game_id
      LIMIT ?
    )
    SELECT page.game_id, page.catalog_version,
      CASE WHEN g.id IS NOT NULL AND ${LISTED('g')} THEN 1 ELSE 0 END AS listed,
      g.display_name, g.english_name,
      CASE WHEN g.id IS NULL THEN '[]' ELSE ${ALIASES('g')} END AS aliases_json,
      COALESCE((
        SELECT json_group_array(bgg_id) FROM (
          SELECT CAST(owner.bgg_id AS TEXT) AS bgg_id
          FROM games owner INDEXED BY sqlite_autoindex_games_1
          WHERE owner.id = page.game_id AND owner.bgg_id IS NOT NULL
          UNION
          SELECT external.external_id
          FROM game_external_ids external INDEXED BY idx_game_external_ids_game_source
          WHERE external.game_id = page.game_id AND external.source = 'bgg'
        )
      ), '[]') AS bgg_ids_json
    FROM page
    LEFT JOIN games g INDEXED BY sqlite_autoindex_games_1 ON g.id = page.game_id
    ORDER BY page.catalog_version, page.game_id
  `).bind(after, size).all<{
    game_id: string; catalog_version: number; listed: number; display_name: string | null;
    english_name: string | null; aliases_json: string; bgg_ids_json: string;
  }>();
  const rows = result.results ?? [];
  const changes = rows.map((row): ScorepadGameChange => {
    const base = { gameId: row.game_id, catalogVersion: Number(row.catalog_version), bggIds: parseStrings(row.bgg_ids_json) };
    if (!row.listed) return { ...base, deleted: true };
    return {
      ...base,
      deleted: false,
      displayName: row.display_name ?? '',
      englishName: row.english_name ?? null,
      aliases: parseStrings(row.aliases_json),
    };
  });
  return {
    changes,
    throughVersion: changes.at(-1)?.catalogVersion ?? after,
    hasMore: rows.length === size,
  };
};
