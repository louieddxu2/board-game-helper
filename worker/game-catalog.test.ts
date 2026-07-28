import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import { gameCatalogPayload, queryGameCatalog, rebuildGameCatalog } from './data/gameCatalog';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

describe('one-row daily game catalog', () => {
  test('reads only the fixed catalog row', async () => {
    const all = vi.fn().mockResolvedValue({ results: [], meta: { rows_read: 1 } });
    const prepared = statement({ all });
    const db = { statement: vi.fn().mockReturnValue(prepared), batch: vi.fn() } as unknown as Database;

    const result = await queryGameCatalog(db);

    expect(db.statement).toHaveBeenCalledWith(expect.stringMatching(/WHERE id = 1/));
    expect(result.meta?.rows_read).toBe(1);
  });

  test('parses the snapshot payload without querying individual games', () => {
    expect(gameCatalogPayload({
      catalog_date: '2026-07-29', generated_at: 123,
      games_json: '[{"id":"g1","slug":"one","displayName":"一","ruleCount":0,"updatedAt":1}]',
    })).toMatchObject({ catalogDate: '2026-07-29', generatedAt: 123, games: [{ id: 'g1' }] });
  });

  test('rebuilds all games once and writes one JSON snapshot row', async () => {
    const sourceRows = Array.from({ length: 500 }, (_, index) => ({
      id: `g${index}`, slug: `game-${index}`, display_name: `遊戲${index}`, english_name: null,
      aliases_json: '["壹"]', published_rule_count: 2, total_rule_count: 3,
      latest_rule_updated_at: 10, updated_at: 11,
    }));
    const select = statement({ all: vi.fn().mockResolvedValue({ results: sourceRows }) });
    const write = statement({ run: vi.fn().mockResolvedValue({ meta: { rows_written: 1 } }) });
    const db = { statement: vi.fn().mockReturnValueOnce(select).mockReturnValueOnce(write), batch: vi.fn() } as unknown as Database;

    const payload = await rebuildGameCatalog(db, Date.UTC(2026, 6, 28, 16));

    expect(payload.catalogDate).toBe('2026-07-29');
    expect(payload.games).toHaveLength(500);
    expect(payload.games[0]).toMatchObject({ id: 'g0', aliases: ['壹'], ruleCount: 2 });
    expect(write.bind).toHaveBeenCalledWith('2026-07-29', expect.stringContaining('"id":"g499"'), Date.UTC(2026, 6, 28, 16));
    expect(write.run).toHaveBeenCalledOnce();
  });
});
