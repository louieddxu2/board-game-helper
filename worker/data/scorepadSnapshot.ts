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

// The whole score pad catalog as a stored snapshot: every unmerged game with a BGG id.
// The daily schedule rebuilds it when the game catalog clock moved; a call reads the
// state row and, only when the caller's version differs, the snapshot's few chunk rows.

export type ScorepadCatalogGame = {
  gameId: string;
  /** At least one; games.bgg_id and game_external_ids together, sorted. */
  bggIds: string[];
  displayName: string;
  englishName: string | null;
  aliases: string[];
} & ScorepadRuleRef;

export type ScorepadCatalog =
  | { unchanged: true; version: string }
  | { unchanged: false; version: string; games: ScorepadCatalogGame[] };

const MAX_CHUNK_BYTES = 900_000;
const VERSION = /^[0-9a-f]{1,64}$/;
const encoder = new TextEncoder();

interface StateRow {
  generation: number;
  version: string;
  through_version: number;
}

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))]
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** One query, driven by the games that carry a BGG id; every table is reached through an index. */
export const queryScorepadCatalogGames = async (db: Database): Promise<ScorepadCatalogGame[]> => {
  const result = await db.statement(`
    WITH candidates(game_id) AS (
      SELECT id FROM games INDEXED BY idx_games_bgg_id WHERE bgg_id IS NOT NULL
      UNION
      SELECT game_id FROM game_external_ids INDEXED BY sqlite_autoindex_game_external_ids_2 WHERE source = 'bgg'
    )
    SELECT g.id AS game_id, g.display_name, g.english_name, ${ALIASES('g')} AS aliases_json,
      ${RULE_REF_COLUMNS('g')},
      (
        SELECT json_group_array(bgg_id) FROM (
          SELECT CAST(g.bgg_id AS TEXT) AS bgg_id WHERE g.bgg_id IS NOT NULL
          UNION
          SELECT external.external_id
          FROM game_external_ids external INDEXED BY idx_game_external_ids_game_source
          WHERE external.game_id = g.id AND external.source = 'bgg'
        )
      ) AS bgg_ids_json
    FROM candidates
    CROSS JOIN games g INDEXED BY sqlite_autoindex_games_1 ON g.id = candidates.game_id
    WHERE ${UNMERGED('g')}
    ORDER BY g.id
  `).all<{ game_id: string; display_name: string; english_name: string | null; aliases_json: string; bgg_ids_json: string } & RuleRefRow>();
  return (result.results ?? []).map((row) => ({
    gameId: row.game_id,
    bggIds: parseStrings(row.bgg_ids_json).sort(),
    displayName: row.display_name,
    englishName: row.english_name ?? null,
    aliases: parseStrings(row.aliases_json),
    ...toRuleRef(row),
  }));
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

/**
 * Rebuilds the snapshot when the game catalog clock moved since the last build. The version is
 * the content's hash, so a rebuild that finds the same games writes only the state row and the
 * score pad sees no change. Returns the games when it read them, else null.
 */
export const rebuildScorepadCatalog = async (db: Database, timestamp = Date.now()): Promise<ScorepadCatalogGame[] | null> => {
  const clock = await db.statement('SELECT current_version FROM game_catalog_clock WHERE id = 1')
    .first<{ current_version: number }>();
  if (!clock) throw new Error('game_catalog_clock_unavailable');
  const throughVersion = Number(clock.current_version);
  const state = await db.statement(`
    SELECT generation, version, through_version FROM scorepad_catalog_snapshot_state WHERE id = 1
  `).first<StateRow>();
  if (state && Number(state.through_version) === throughVersion) return null;
  const games = await queryScorepadCatalogGames(db);
  const chunks = chunk(games);
  const version = (await sha256(chunks.join('\n'))).slice(0, 16);
  if (state?.version === version) {
    await db.statement('UPDATE scorepad_catalog_snapshot_state SET through_version = ?, checked_at = ? WHERE id = 1')
      .bind(throughVersion, timestamp).run();
    return games;
  }
  const generation = Math.max(timestamp, Number(state?.generation ?? 0) + 1);
  await db.batch([
    ...chunks.map((gamesJson, chunkNumber) => db.statement(`
      INSERT OR REPLACE INTO scorepad_catalog_snapshot_chunks (generation, chunk_number, games_json) VALUES (?, ?, ?)
    `).bind(generation, chunkNumber, gamesJson)),
    db.statement(`
      INSERT INTO scorepad_catalog_snapshot_state (id, generation, version, through_version, chunk_count, generated_at, checked_at)
      VALUES (1, ?1, ?2, ?3, ?4, ?5, ?5)
      ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, version = excluded.version,
        through_version = excluded.through_version, chunk_count = excluded.chunk_count,
        generated_at = excluded.generated_at, checked_at = excluded.checked_at
    `).bind(generation, version, throughVersion, chunks.length, timestamp),
    db.statement('DELETE FROM scorepad_catalog_snapshot_chunks WHERE generation <> ?').bind(generation),
  ]);
  return games;
};

/**
 * One query: the state row, plus the snapshot's chunks only when knownVersion differs.
 * Before the first scheduled build the call builds the snapshot itself, once.
 */
export const getScorepadCatalog = async (db: Database, knownVersion: unknown): Promise<ScorepadCatalog> => {
  if (knownVersion !== undefined && knownVersion !== null && (typeof knownVersion !== 'string' || !VERSION.test(knownVersion))) {
    throw new TypeError('scorepad_catalog_version_must_be_a_version_string');
  }
  const known = typeof knownVersion === 'string' ? knownVersion : null;
  const read = async () => (await db.statement(`
    SELECT state.version, state.chunk_count, chunk.games_json
    FROM scorepad_catalog_snapshot_state state
    LEFT JOIN scorepad_catalog_snapshot_chunks chunk
      ON chunk.generation = state.generation AND state.version IS NOT ?
    WHERE state.id = 1
    ORDER BY chunk.chunk_number
  `).bind(known).all<{ version: string; chunk_count: number; games_json: string | null }>()).results ?? [];
  let rows = await read();
  if (!rows.length) {
    await rebuildScorepadCatalog(db);
    rows = await read();
  }
  const [first] = rows;
  if (!first) throw new Error('scorepad_catalog_unavailable');
  if (first.version === known) return { unchanged: true, version: first.version };
  const chunks = rows.filter((row) => row.games_json !== null);
  if (chunks.length !== Number(first.chunk_count)) throw new Error('incomplete_scorepad_catalog_snapshot');
  return {
    unchanged: false,
    version: first.version,
    games: chunks.flatMap((row) => JSON.parse(row.games_json!) as ScorepadCatalogGame[]),
  };
};
