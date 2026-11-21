// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { beforeAll, describe, expect, test } from 'vitest';
import type { AppVariables } from './auth';
import type { Database, DatabaseStatement } from './data/database';
import type { RouteEnv } from './env';
import { rulesRoutes } from './routes/rules';

// Real schema and triggers: reviewing a rule also accepts the pending games it was submitted for.
const sqlite = new DatabaseSync(':memory:');
const statement = (sql: string, params: unknown[] = []): DatabaseStatement => ({
  bind: (...values: unknown[]) => statement(sql, values),
  first: async () => (sqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
  all: async () => ({ results: sqlite.prepare(sql).all(...(params as never[])), success: true, meta: {} }) as never,
  run: async () => {
    const result = sqlite.prepare(sql).run(...(params as never[]));
    return { results: [], success: true, meta: { changes: Number(result.changes) } } as never;
  },
});
const db: Database = {
  statement: (sql) => statement(sql),
  batch: async (items) => { const results = []; for (const item of items) results.push(await item.run()); return results; },
};
const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
app.use('*', async (c, next) => {
  c.set('database', db);
  c.set('user', { id: 'u-editor', roles: ['editor'] });
  await next();
});
app.route('/', rulesRoutes);
const review = (ruleId: string) => app.request(`https://rules.example/api/rules/${ruleId}/review`, { method: 'POST', body: '{}' });
const gameStatus = (id: string) => sqlite.prepare('SELECT review_status, reviewed_by_nickname FROM games WHERE id = ?').get(id);

beforeAll(() => {
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO users (id, google_sub, email, email_normalized, created_at, last_login_at, nickname, show_nickname)
    VALUES ('u-new', 'sub-new', 'x', 'x-new', 1, 1, NULL, 0), ('u-editor', 'sub-editor', 'y', 'y-editor', 1, 1, '審核者', 1);
    INSERT INTO user_roles (user_id, role, granted_at) VALUES ('u-editor', 'editor', 1);
    INSERT INTO games (id, slug, display_name, normalized_name, created_by, created_at, updated_at, review_status)
    VALUES ('g-base', 'g-base', 'Base', 'base', 'u-new', 1, 1, 'pending'),
      ('g-expansion', 'g-expansion', 'Expansion', 'expansion', 'u-new', 1, 1, 'pending'),
      ('g-unrelated', 'g-unrelated', 'Unrelated', 'unrelated', 'u-new', 1, 1, 'pending');
    INSERT INTO submissions (id, game_id, author_id) VALUES ('s1', 'g-base', 'u-new');
    INSERT INTO rules (id, submission_id, game_id, statement, created_by, created_at, updated_at, review_status, pending_review_by)
    VALUES ('r1', 's1', 'g-base', 'A', 'u-new', 1, 1, 'pending', 'u-new');
    INSERT INTO rule_game_variants (rule_id, game_id, created_at) VALUES ('r1', 'g-expansion', 1);
  `);
});

describe('reviewing a rule', () => {
  test('also reviews its pending game and the expansion it names, but no other game', async () => {
    const response = await review('r1');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reviewStatus: 'reviewed', reviewedByNickname: '審核者', gameReviewed: true });
    expect(gameStatus('g-base')).toEqual({ review_status: 'reviewed', reviewed_by_nickname: '審核者' });
    expect(gameStatus('g-expansion')).toEqual({ review_status: 'reviewed', reviewed_by_nickname: '審核者' });
    expect(gameStatus('g-unrelated')).toMatchObject({ review_status: 'pending' });
  });
});
