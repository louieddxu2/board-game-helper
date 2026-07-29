import { describe, expect, test, vi } from 'vitest';
import type { GameSummary } from '../src/shared/types';
import type { Database, DatabaseStatement } from './data/database';
import {
  chunkGameCatalog,
  gameCatalogChangesPayload,
  gameCatalogPayload,
  queryGameCatalogChanges,
  queryGameCatalogSnapshot,
  rebuildGameCatalog,
} from './data/gameCatalog';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

const game = (index: number): GameSummary => ({
  id: `g${index}`,
  slug: `game-${index}`,
  displayName: `遊戲${index}`,
  aliases: [],
  ruleCount: 2,
  totalRuleCount: 3,
  updatedAt: 11,
});

describe('versioned weekly game catalog', () => {
  test('reads one state row and only the active snapshot chunks', async () => {
    const stateStatement = statement({ all: vi.fn().mockResolvedValue({
      results: [{ active_generation: 7, through_version: 12, chunk_count: 1, generated_at: 123 }],
      meta: { rows_read: 1 },
    }) });
    const chunksStatement = statement({ all: vi.fn().mockResolvedValue({
      results: [{ chunk_number: 0, games_json: JSON.stringify([game(1)]) }],
      meta: { rows_read: 1 },
    }) });
    const db = { statement: vi.fn().mockReturnValueOnce(stateStatement).mockReturnValueOnce(chunksStatement), batch: vi.fn() } as unknown as Database;

    const query = await queryGameCatalogSnapshot(db);
    const payload = gameCatalogPayload(query);

    expect(stateStatement.all).toHaveBeenCalledOnce();
    expect(chunksStatement.bind).toHaveBeenCalledWith(7);
    expect(payload).toMatchObject({ generation: 7, throughVersion: 12, games: [{ id: 'g1' }] });
  });

  test('reads only versions newer than the client cursor', async () => {
    const all = vi.fn().mockResolvedValue({ results: [{
      game_id: 'g2', catalog_version: 13, entry_json: JSON.stringify(game(2)), deleted: 0,
    }], meta: { rows_read: 1 } });
    const prepared = statement({ all });
    const db = { statement: vi.fn().mockReturnValue(prepared), batch: vi.fn() } as unknown as Database;

    const result = await queryGameCatalogChanges(db, 12);
    const payload = gameCatalogChangesPayload(result, 12);

    expect(db.statement).toHaveBeenCalledWith(expect.stringMatching(/catalog_version > \?/));
    expect(prepared.bind).toHaveBeenCalledWith(12, 1000);
    expect(payload).toMatchObject({ throughVersion: 13, hasMore: false, changes: [{ gameId: 'g2', deleted: false }] });
  });

  test('represents deletions without retaining a redundant game payload', () => {
    const payload = gameCatalogChangesPayload({ results: [{
      game_id: 'g2', catalog_version: 14, entry_json: null, deleted: 1,
    }] }, 13);

    expect(payload.changes).toEqual([{ gameId: 'g2', catalogVersion: 14, deleted: true, game: undefined }]);
  });

  test('chunks snapshots at one thousand games', () => {
    const chunks = chunkGameCatalog(Array.from({ length: 2501 }, (_, index) => game(index)));

    expect(chunks.map((chunk) => chunk.length)).toEqual([1000, 1000, 501]);
  });

  test('rebuilds a generation and removes older snapshot chunks in one batch', async () => {
    const clock = statement({ first: vi.fn().mockResolvedValue({ current_version: 25 }) });
    const source = statement({ all: vi.fn().mockResolvedValue({
      results: Array.from({ length: 1001 }, (_, index) => ({ entry_json: JSON.stringify(game(index)) })),
    }) });
    const writes: DatabaseStatement[] = [];
    const db = {
      statement: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT current_version')) return clock;
        if (sql.includes('SELECT entry_json')) return source;
        const prepared = statement();
        writes.push(prepared);
        return prepared;
      }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    const payload = await rebuildGameCatalog(db, 456);

    expect(payload).toMatchObject({ generation: 456, throughVersion: 25, generatedAt: 456 });
    expect(payload.games).toHaveLength(1001);
    expect(db.batch).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(5);
    expect(writes[0].bind).toHaveBeenCalledWith(456);
    expect(writes[1].bind).toHaveBeenCalledWith(456, 0, expect.any(String));
    expect(writes[2].bind).toHaveBeenCalledWith(456, 1, expect.any(String));
    expect(writes[3].bind).toHaveBeenCalledWith(456, 25, 2, 456);
    expect(writes[4].bind).toHaveBeenCalledWith(456);
  });
});
