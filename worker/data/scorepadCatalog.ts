import type { Database } from './database';
import { ruleVersionOf } from './scorepadRules';

// Read-only game data for the score pad Worker, reached only through the
// ScorepadApi Service Binding entrypoint. Every method issues one D1 query,
// whatever the list or page size, to stay within the free plan's limits.

export const SCOREPAD_BGG_LOOKUP_LIMIT = 100;
export const SCOREPAD_CHANGES_PAGE_LIMIT = 200;

/**
 * Where a game's rules live, so a score pad shows the rule count without asking.
 * A listed base game names itself and carries its count and version; an expansion
 * or version names its base game and carries neither, so read them from the base
 * game's own entry, which stays current when its rules change. Null: no rules here.
 */
export interface ScorepadRuleRef {
  ruleGameId: string | null;
  /** Only on the entry whose gameId is ruleGameId. */
  publishedRuleCount?: number;
  /** Only on the entry whose gameId is ruleGameId; equals getRuleSummaryByBgg's. */
  ruleVersion?: string;
}

export interface ScorepadGame extends ScorepadRuleRef {
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
  /** Present when not deleted. */
  ruleGameId?: string | null;
  publishedRuleCount?: number;
  ruleVersion?: string;
}

export interface ScorepadGameChanges {
  changes: ScorepadGameChange[];
  throughVersion: number;
  hasMore: boolean;
}

// Every game the public site lists (public and not merged away), plus hidden
// expansions and versions that carry a BGG id: the site keeps those hidden while
// their names await review, yet a score pad can play them and reach their base
// game's rules. A pending review_status only marks data awaiting an editor.
const UNMERGED = (alias: string) => `${alias}.merged_into_game_id IS NULL`;
const IS_PUBLIC = (alias: string) => `${alias}.visibility = 'public'`;

const ALIASES = (alias: string) => `COALESCE((
    SELECT json_group_array(alias) FROM (
      SELECT alias FROM game_aliases INDEXED BY idx_game_aliases_unique
      WHERE game_id = ${alias}.id ORDER BY alias
    )
  ), '[]')`;

// The columns behind ScorepadRuleRef, by the rules site's own rule: a base game
// that is listed holds its rules; an expansion or version leads, through its
// relation, to a listed base game. One primary-key or index lookup per game.
const RULE_REF_COLUMNS = (alias: string) => `
  CASE WHEN COALESCE(${alias}.entity_kind, 'base') = 'base'
    THEN CASE WHEN ${IS_PUBLIC(alias)} AND ${UNMERGED(alias)} THEN ${alias}.id END
    ELSE (
      SELECT base.id
      FROM game_entity_relations relation INDEXED BY idx_game_entity_relations_source_type_target
      CROSS JOIN games base INDEXED BY sqlite_autoindex_games_1 ON base.id = relation.target_game_id
      WHERE relation.source_game_id = ${alias}.id
        AND relation.relation_type IN ('expansion_of', 'version_of', 'variant_of')
        AND base.entity_kind = 'base' AND ${IS_PUBLIC('base')} AND ${UNMERGED('base')}
      ORDER BY relation.id LIMIT 1
    ) END AS rule_game_id,
  ${alias}.published_rule_count, ${alias}.latest_rule_updated_at`;

interface RuleRefRow {
  game_id: string;
  rule_game_id: string | null;
  published_rule_count: number | null;
  latest_rule_updated_at: number | null;
}

const toRuleRef = (row: RuleRefRow): ScorepadRuleRef => row.rule_game_id === row.game_id
  ? {
    ruleGameId: row.rule_game_id,
    publishedRuleCount: Number(row.published_rule_count ?? 0),
    ruleVersion: ruleVersionOf(row.latest_rule_updated_at, row.published_rule_count),
  }
  : { ruleGameId: row.rule_game_id ?? null };

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
    SELECT matched.bgg_id, g.id AS game_id, g.display_name, g.english_name, ${ALIASES('g')} AS aliases_json,
      ${RULE_REF_COLUMNS('g')}
    FROM matched
    CROSS JOIN games g INDEXED BY sqlite_autoindex_games_1 ON g.id = matched.game_id
    WHERE ${UNMERGED('g')}
    ORDER BY matched.bgg_id, g.id
  `).bind(JSON.stringify(ids)).all<{
    bgg_id: string; game_id: string; display_name: string; english_name: string | null; aliases_json: string;
  } & RuleRefRow>();
  return (result.results ?? []).map((row) => ({
    bggId: String(row.bgg_id),
    gameId: row.game_id,
    displayName: row.display_name,
    englishName: row.english_name ?? null,
    aliases: parseStrings(row.aliases_json),
    ...toRuleRef(row),
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
// catalog. The current game row decides what is listed, so merged, removed and
// hidden games without a BGG id come back as deleted. The page drives every lookup.
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
      CASE WHEN g.id IS NOT NULL AND ${UNMERGED('g')} THEN 1 ELSE 0 END AS present,
      CASE WHEN ${IS_PUBLIC('g')} THEN 1 ELSE 0 END AS is_public,
      g.display_name, g.english_name,
      CASE WHEN g.id IS NULL THEN '[]' ELSE ${ALIASES('g')} END AS aliases_json,
      ${RULE_REF_COLUMNS('g')},
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
    game_id: string; catalog_version: number; present: number; is_public: number; display_name: string | null;
    english_name: string | null; aliases_json: string; bgg_ids_json: string;
  } & RuleRefRow>();
  const rows = result.results ?? [];
  const changes = rows.map((row): ScorepadGameChange => {
    const base = { gameId: row.game_id, catalogVersion: Number(row.catalog_version), bggIds: parseStrings(row.bgg_ids_json) };
    if (!row.present || (!row.is_public && !base.bggIds.length)) return { ...base, deleted: true };
    return {
      ...base,
      deleted: false,
      displayName: row.display_name ?? '',
      englishName: row.english_name ?? null,
      aliases: parseStrings(row.aliases_json),
      ...toRuleRef(row),
    };
  });
  return {
    changes,
    throughVersion: changes.at(-1)?.catalogVersion ?? after,
    hasMore: rows.length === size,
  };
};
