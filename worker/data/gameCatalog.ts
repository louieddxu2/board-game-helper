import type { GameCatalogChange, GameCatalogChangesPayload, GameCatalogPayload, GameSummary } from '../../src/shared/types';
import type { Database, D1Result } from './database';

const MAX_GAMES_PER_CHUNK = 1000;
const MAX_CHUNK_BYTES = 1_000_000;
const textEncoder = new TextEncoder();

interface SnapshotStateRow {
  active_generation: number;
  through_version: number;
  chunk_count: number;
  generated_at: number;
}

interface SnapshotChunkRow {
  chunk_number: number;
  games_json: string;
}

interface CatalogEntryRow {
  game_id: string;
  catalog_version: number;
  entry_json: string | null;
  deleted: number;
}

export interface GameCatalogSnapshotQuery {
  state: D1Result<SnapshotStateRow>;
  chunks: D1Result<SnapshotChunkRow>;
}

const parseGameSummary = (value: string): GameSummary => {
  const parsed = JSON.parse(value) as GameSummary;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') throw new Error('invalid_game_catalog_entry');
  return parsed;
};

export const queryGameCatalogSnapshot = async (db: Database): Promise<GameCatalogSnapshotQuery> => {
  const state = await db.statement(`
    SELECT active_generation, through_version, chunk_count, generated_at
    FROM game_catalog_snapshot_state
    WHERE id = 1
  `).all<SnapshotStateRow>();
  const row = state.results?.[0];
  if (!row) return { state, chunks: { results: [] } };
  const chunks = await db.statement(`
    SELECT chunk_number, games_json
    FROM game_catalog_snapshot_chunks
    WHERE generation = ?
    ORDER BY chunk_number
  `).bind(row.active_generation).all<SnapshotChunkRow>();
  return { state, chunks };
};

export const gameCatalogPayload = ({ state, chunks }: GameCatalogSnapshotQuery): GameCatalogPayload => {
  const stateRow = state.results?.[0];
  if (!stateRow) throw new Error('game_catalog_unavailable');
  const chunkRows = chunks.results ?? [];
  if (chunkRows.length !== Number(stateRow.chunk_count)) throw new Error('incomplete_game_catalog_snapshot');
  const games = chunkRows.flatMap((row) => {
    const parsed = JSON.parse(row.games_json) as unknown;
    if (!Array.isArray(parsed)) throw new Error('invalid_game_catalog_chunk');
    return parsed as GameSummary[];
  });
  return {
    generation: Number(stateRow.active_generation),
    throughVersion: Number(stateRow.through_version),
    generatedAt: Number(stateRow.generated_at),
    games,
  };
};

export const queryGameCatalogChanges = (
  db: Database,
  afterVersion: number,
  limit = 1000,
): Promise<D1Result<CatalogEntryRow>> => db.statement(`
  SELECT game_id, catalog_version, entry_json, deleted
  FROM game_catalog_entries
  WHERE catalog_version > ?
  ORDER BY catalog_version, game_id
  LIMIT ?
`).bind(afterVersion, limit).all<CatalogEntryRow>();

export const gameCatalogChangesPayload = (
  result: D1Result<CatalogEntryRow>,
  afterVersion: number,
  limit = 1000,
): GameCatalogChangesPayload => {
  const rows = result.results ?? [];
  const changes: GameCatalogChange[] = rows.map((row) => ({
    gameId: row.game_id,
    catalogVersion: Number(row.catalog_version),
    deleted: Boolean(row.deleted),
    game: row.deleted || !row.entry_json ? undefined : parseGameSummary(row.entry_json),
  }));
  return {
    changes,
    throughVersion: changes.at(-1)?.catalogVersion ?? afterVersion,
    hasMore: rows.length === limit,
  };
};

export const chunkGameCatalog = (games: GameSummary[]): GameSummary[][] => {
  const chunks: GameSummary[][] = [];
  let current: GameSummary[] = [];
  let currentBytes = 2;
  for (const game of games) {
    const gameBytes = textEncoder.encode(JSON.stringify(game)).byteLength;
    if (gameBytes + 2 > MAX_CHUNK_BYTES) throw new Error(`game_catalog_entry_too_large:${game.id}`);
    const nextBytes = currentBytes + gameBytes + (current.length ? 1 : 0);
    if (current.length && (current.length >= MAX_GAMES_PER_CHUNK || nextBytes > MAX_CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(game);
    currentBytes += gameBytes + (current.length > 1 ? 1 : 0);
  }
  chunks.push(current);
  return chunks;
};

export const rebuildGameCatalog = async (db: Database, timestamp = Date.now()): Promise<GameCatalogPayload> => {
  const clock = await db.statement('SELECT current_version FROM game_catalog_clock WHERE id = 1')
    .first<{ current_version: number }>();
  if (!clock) throw new Error('game_catalog_clock_unavailable');
  const throughVersion = Number(clock.current_version);
  const source = await db.statement(`
    SELECT entry_json
    FROM game_catalog_entries
    WHERE deleted = 0 AND entry_json IS NOT NULL
    ORDER BY json_extract(entry_json, '$.displayName'), game_id
  `).all<{ entry_json: string }>();
  const games = (source.results ?? []).map((row) => parseGameSummary(row.entry_json));
  const chunks = chunkGameCatalog(games);
  const generation = timestamp;
  const statements = [db.statement('DELETE FROM game_catalog_snapshot_chunks WHERE generation = ?').bind(generation)];
  statements.push(...chunks.map((chunk, chunkNumber) => db.statement(`
    INSERT OR REPLACE INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
    VALUES (?, ?, ?)
  `).bind(generation, chunkNumber, JSON.stringify(chunk))));
  statements.push(db.statement(`
    INSERT INTO game_catalog_snapshot_state (id, active_generation, through_version, chunk_count, generated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      active_generation = excluded.active_generation,
      through_version = excluded.through_version,
      chunk_count = excluded.chunk_count,
      generated_at = excluded.generated_at
  `).bind(generation, throughVersion, chunks.length, timestamp));
  statements.push(db.statement('DELETE FROM game_catalog_snapshot_chunks WHERE generation <> ?').bind(generation));
  await db.batch(statements);
  return { generation, throughVersion, generatedAt: timestamp, games };
};
