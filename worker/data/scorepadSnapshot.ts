import { GAME_ENTITY_KINDS, type GameEntityKind } from '../../src/shared/gameEntity';
import type { Database } from './database';
import {
  ALIASES,
  RULE_REF_COLUMNS,
  UNMERGED,
  parseStrings,
  toRuleRef,
  type RuleRefRow,
  type ScorepadRuleRef,
} from './scorepadCatalog';

// The score pad catalog, built like the site's own game catalog: one stored entry per game,
// refreshed for the games each catalog outbox flush touches, plus a weekly snapshot of those
// entries. A call reads the snapshot and the entries changed since it, or one row when current.

export type ScorepadCatalogGame = {
  gameId: string;
  /** At least one; games.bgg_id and game_external_ids together, sorted. */
  bggIds: string[];
  displayName: string;
  englishName: string | null;
  aliases: string[];
  /** games.entity_kind; a score pad offers only base and unknown games when a game is set up. */
  entityKind: GameEntityKind;
} & ScorepadRuleRef;

export type ScorepadCatalog =
  | { unchanged: true; version: string }
  | { unchanged: false; version: string; games: ScorepadCatalogGame[] };

const MAX_CHUNK_BYTES = 900_000;
const VERSION = /^\d{1,16}$/;
const RELATION_TYPES = `('expansion_of', 'version_of', 'variant_of')`;
const encoder = new TextEncoder();

type GameRow = {
  game_id: string; present: number; display_name: string | null; english_name: string | null; entity_kind: string | null;
  aliases_json: string; bgg_ids_json: string;
} & RuleRefRow;

const COLUMNS = (id: string) => `${id} AS game_id,
  CASE WHEN g.id IS NOT NULL AND ${UNMERGED('g')} THEN 1 ELSE 0 END AS present,
  g.display_name, g.english_name, g.entity_kind,
  CASE WHEN g.id IS NULL THEN '[]' ELSE ${ALIASES('g')} END AS aliases_json,
  ${RULE_REF_COLUMNS('g')},
  (
    SELECT json_group_array(bgg_id) FROM (
      SELECT CAST(g.bgg_id AS TEXT) AS bgg_id WHERE g.bgg_id IS NOT NULL
      UNION
      SELECT external.external_id
      FROM game_external_ids external INDEXED BY idx_game_external_ids_game_source
      WHERE external.game_id = ${id} AND external.source = 'bgg'
    )
  ) AS bgg_ids_json`;

/** The game, or null when the score pad must not list it (merged, removed, or without a BGG id). */
const toGame = (row: GameRow): ScorepadCatalogGame | null => {
  const bggIds = parseStrings(row.bgg_ids_json).sort();
  if (!row.present || !bggIds.length) return null;
  return {
    gameId: row.game_id,
    bggIds,
    displayName: row.display_name ?? '',
    englishName: row.english_name ?? null,
    aliases: parseStrings(row.aliases_json),
    entityKind: (GAME_ENTITY_KINDS as readonly string[]).includes(row.entity_kind ?? '') ? row.entity_kind as GameEntityKind : 'base',
    ...toRuleRef(row),
  };
};

/** Every listable game in one query, driven by the games that carry a BGG id. */
export const queryScorepadCatalogGames = async (db: Database): Promise<ScorepadCatalogGame[]> => {
  const result = await db.statement(`
    WITH candidates(game_id) AS (
      SELECT id FROM games INDEXED BY idx_games_bgg_id WHERE bgg_id IS NOT NULL
      UNION
      SELECT game_id FROM game_external_ids INDEXED BY sqlite_autoindex_game_external_ids_2 WHERE source = 'bgg'
    )
    SELECT ${COLUMNS('candidates.game_id')}
    FROM candidates
    CROSS JOIN games g INDEXED BY sqlite_autoindex_games_1 ON g.id = candidates.game_id
    ORDER BY candidates.game_id
  `).all<GameRow>();
  return (result.results ?? []).map(toGame).filter((game): game is ScorepadCatalogGame => game !== null);
};

/**
 * The given games and the expansions and versions that lead to them, whose rule reference
 * follows their base game; null for each one the score pad must not list. One query.
 */
const queryTargetedGames = async (db: Database, gameIds: string[]): Promise<Map<string, ScorepadCatalogGame | null>> => {
  const result = await db.statement(`
    WITH requested(game_id) AS (SELECT value FROM json_each(?)),
    candidates(game_id) AS (
      SELECT game_id FROM requested
      UNION
      SELECT relation.source_game_id
      FROM requested
      CROSS JOIN game_entity_relations relation INDEXED BY idx_game_entity_relations_target_type_source
        ON relation.target_game_id = requested.game_id AND relation.relation_type IN ${RELATION_TYPES}
    )
    SELECT ${COLUMNS('candidates.game_id')}
    FROM candidates
    LEFT JOIN games g INDEXED BY sqlite_autoindex_games_1 ON g.id = candidates.game_id
  `).bind(JSON.stringify(gameIds)).all<GameRow>();
  return new Map((result.results ?? []).map((row) => [row.game_id, toGame(row)]));
};

const chunk = (games: ScorepadCatalogGame[]): string[] => {
  const chunks: string[] = [];
  let current: string[] = [];
  let bytes = 2;
  for (const game of games) {
    const json = JSON.stringify(game);
    const size = encoder.encode(json).byteLength + 1;
    if (current.length && bytes + size > MAX_CHUNK_BYTES) {
      chunks.push(`[${current.join(',')}]`);
      current = [];
      bytes = 2;
    }
    current.push(json);
    bytes += size;
  }
  chunks.push(`[${current.join(',')}]`);
  return chunks;
};

interface StateRow {
  generation: number;
  through_version: number;
  entries_version: number;
  chunk_count: number;
}

const readState = (db: Database) => db.statement(`
  SELECT generation, through_version, entries_version, chunk_count FROM scorepad_catalog_snapshot_state WHERE id = 1
`).first<StateRow>();

const writeSnapshot = (db: Database, games: ScorepadCatalogGame[], throughVersion: number, previous: StateRow | null, timestamp: number) => {
  const chunks = chunk(games);
  const generation = Math.max(timestamp, Number(previous?.generation ?? 0) + 1);
  return [
    ...chunks.map((gamesJson, chunkNumber) => db.statement(`
      INSERT OR REPLACE INTO scorepad_catalog_snapshot_chunks (generation, chunk_number, games_json) VALUES (?, ?, ?)
    `).bind(generation, chunkNumber, gamesJson)),
    db.statement(`
      INSERT INTO scorepad_catalog_snapshot_state (id, generation, through_version, entries_version, chunk_count, generated_at)
      VALUES (1, ?1, ?2, ?2, ?3, ?4)
      ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, through_version = excluded.through_version,
        chunk_count = excluded.chunk_count, generated_at = excluded.generated_at
    `).bind(generation, throughVersion, chunks.length, timestamp),
    db.statement('DELETE FROM scorepad_catalog_snapshot_chunks WHERE generation <> ?').bind(generation),
    // A snapshot carries every entry up to its version, so older removals are no longer needed.
    db.statement('DELETE FROM scorepad_catalog_entries WHERE deleted = 1 AND entry_version <= ?').bind(throughVersion),
  ];
};

/** First build: every entry and the snapshot from the source tables, once. */
const bootstrap = async (db: Database, timestamp: number) => {
  // A rebuild (a migration clears the state row when the entry format changes) continues after
  // the stored entries, so a score pad holding an older version always receives the new games.
  const previous = await db.statement('SELECT MAX(entry_version) AS version FROM scorepad_catalog_entries')
    .first<{ version: number | null }>();
  const version = Number(previous?.version ?? 0) + 1;
  const games = await queryScorepadCatalogGames(db);
  await db.batch([
    db.statement('DELETE FROM scorepad_catalog_entries'),
    ...games.map((game) => db.statement(`
      INSERT INTO scorepad_catalog_entries (game_id, entry_version, entry_json, deleted) VALUES (?, ?, ?, 0)
    `).bind(game.gameId, version, JSON.stringify(game))),
    ...writeSnapshot(db, games, version, null, timestamp),
  ]);
};

/**
 * Called by the catalog outbox flush for the games it publishes. Rewrites only the entries
 * whose content changed, each with a new version. Before the first build there is nothing to update.
 */
export const updateScorepadCatalogEntries = async (db: Database, gameIds: string[]): Promise<number> => {
  if (!gameIds.length) return 0;
  if (!(await readState(db))) return 0;
  const games = await queryTargetedGames(db, gameIds);
  const ids = [...games.keys()];
  const existing = await db.statement(`
    SELECT game_id, entry_json, deleted FROM scorepad_catalog_entries INDEXED BY sqlite_autoindex_scorepad_catalog_entries_1
    WHERE game_id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(ids)).all<{ game_id: string; entry_json: string | null; deleted: number }>();
  const before = new Map((existing.results ?? []).map((row) => [row.game_id, row.deleted ? null : row.entry_json]));
  const changed = ids.sort().flatMap((id) => {
    const game = games.get(id);
    const json = game ? JSON.stringify(game) : null;
    if (!before.has(id) && json === null) return [];
    return before.get(id) === json ? [] : [{ id, json }];
  });
  if (!changed.length) return 0;
  const clock = await db.statement(`
    UPDATE scorepad_catalog_snapshot_state SET entries_version = entries_version + ? WHERE id = 1 RETURNING entries_version
  `).bind(changed.length).first<{ entries_version: number }>();
  if (!clock) return 0;
  const start = Number(clock.entries_version) - changed.length + 1;
  await db.batch(changed.map((entry, index) => db.statement(`
    INSERT INTO scorepad_catalog_entries (game_id, entry_version, entry_json, deleted) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(game_id) DO UPDATE SET entry_version = excluded.entry_version,
      entry_json = excluded.entry_json, deleted = excluded.deleted
  `).bind(entry.id, start + index, entry.json, entry.json === null ? 1 : 0)));
  return changed.length;
};

/**
 * The weekly snapshot, read from the stored entries alone. Skipped when no entry changed since
 * the last one; builds everything from the source tables the first time.
 */
export const rebuildScorepadCatalog = async (db: Database, timestamp = Date.now()): Promise<boolean> => {
  const state = await readState(db);
  if (!state) {
    await bootstrap(db, timestamp);
    return true;
  }
  const latest = Number(state.entries_version);
  if (latest === Number(state.through_version)) return false;
  const entries = await db.statement(`
    SELECT entry_json FROM scorepad_catalog_entries INDEXED BY sqlite_autoindex_scorepad_catalog_entries_1
    WHERE deleted = 0 AND entry_version <= ? ORDER BY game_id
  `).bind(latest).all<{ entry_json: string }>();
  const games = (entries.results ?? []).map((row) => JSON.parse(row.entry_json) as ScorepadCatalogGame);
  await db.batch(writeSnapshot(db, games, latest, state, timestamp));
  return true;
};

/**
 * One state-row read when knownVersion is current; otherwise one more query for the snapshot's
 * chunks and the entries changed since it. Before the first build the call builds it, once.
 */
export const getScorepadCatalog = async (db: Database, knownVersion: unknown): Promise<ScorepadCatalog> => {
  if (knownVersion !== undefined && knownVersion !== null && (typeof knownVersion !== 'string' || !VERSION.test(knownVersion))) {
    throw new TypeError('scorepad_catalog_version_must_be_a_version_string');
  }
  let state = await readState(db);
  if (!state) {
    await rebuildScorepadCatalog(db);
    state = await readState(db);
    if (!state) throw new Error('scorepad_catalog_unavailable');
  }
  const version = String(state.entries_version);
  if (version === knownVersion) return { unchanged: true, version };
  const rows = await db.statement(`
    SELECT 0 AS kind, chunk_number AS ord, games_json AS json, NULL AS game_id, 0 AS deleted
    FROM scorepad_catalog_snapshot_chunks WHERE generation = ?1
    UNION ALL
    SELECT 1, entry_version, entry_json, game_id, deleted
    FROM scorepad_catalog_entries INDEXED BY idx_scorepad_catalog_entries_version
    WHERE entry_version > ?2 AND entry_version <= ?3
    ORDER BY kind, ord
  `).bind(state.generation, state.through_version, state.entries_version)
    .all<{ kind: number; json: string | null; game_id: string | null; deleted: number }>();
  const all = rows.results ?? [];
  const chunks = all.filter((row) => row.kind === 0);
  if (chunks.length !== Number(state.chunk_count)) throw new Error('incomplete_scorepad_catalog_snapshot');
  const games = new Map<string, ScorepadCatalogGame>();
  chunks.forEach((row) => (JSON.parse(row.json!) as ScorepadCatalogGame[]).forEach((game) => games.set(game.gameId, game)));
  all.filter((row) => row.kind === 1).forEach((row) => {
    if (row.deleted || !row.json) games.delete(row.game_id!);
    else games.set(row.game_id!, JSON.parse(row.json) as ScorepadCatalogGame);
  });
  return { unchanged: false, version, games: [...games.values()].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)) };
};
