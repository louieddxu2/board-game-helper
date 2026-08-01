import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import type { Env } from './env';
import adminRoutes from './routes/admin';

type RecordedStatement = DatabaseStatement & { sql: string; bindings: unknown[] };

describe('legacy import game creation', () => {
  test('creates a new game and its imported rule in the same atomic batch', async () => {
    const recorded: RecordedStatement[] = [];
    const statement = (sql: string): RecordedStatement => {
      const item: RecordedStatement = {
        sql,
        bindings: [],
        bind: vi.fn((...bindings: unknown[]) => { item.bindings = bindings; return item; }),
        first: async <T = Record<string, unknown>>() => {
          if (sql.includes('SELECT * FROM legacy_import_rows')) return {
            id: 'legacy-1', raw_name: 'Legacy Game', suggested_display_name: 'Legacy Game',
            suggested_english_name: null, raw_statement: 'Raw rule', suggested_statement: 'Imported rule',
            suggested_common_mistake: null, suggested_details: null, suggested_flow_stage: 'uncategorized',
            suggested_player_count_note: null, suggested_edition_note: null, raw_source_label: null,
            raw_source_url: null, suggested_tags_json: '[]', status: 'pending', matched_game_id: null,
          } as T;
          return null;
        },
        all: vi.fn(async () => ({ results: [], meta: {} })),
        run: vi.fn(async () => ({ results: [], meta: {} })),
      };
      recorded.push(item);
      return item;
    };
    let batched: DatabaseStatement[] = [];
    const db = {
      statement,
      batch: vi.fn(async (statements: DatabaseStatement[]) => { batched = statements; return []; }),
    } as Database;
    const app = new Hono<{ Bindings: Env; Variables: any }>();
    app.use('*', async (c, next) => {
      c.set('user', { id: 'editor-1', roles: ['editor'] });
      c.set('database', db);
      await next();
    });
    app.route('/', adminRoutes);

    const response = await app.request('https://rules.example/api/admin/import-rows/legacy-1/confirm', { method: 'POST' });

    expect(response.status).toBe(200);
    const gameIndex = batched.findIndex((item) => (item as RecordedStatement).sql.includes('INSERT INTO games'));
    const ruleIndex = batched.findIndex((item) => (item as RecordedStatement).sql.includes('INSERT INTO rules'));
    expect(gameIndex).toBeGreaterThanOrEqual(0);
    expect(ruleIndex).toBeGreaterThan(gameIndex);
    const gameInsert = recorded.find((item) => item.sql.includes('INSERT INTO games'))!;
    expect(gameInsert.run).not.toHaveBeenCalled();
  });
});
