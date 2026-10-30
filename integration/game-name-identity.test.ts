// @vitest-environment node
import { type SQLInputValue } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
// @ts-expect-error Intentional operator helper also used by the release gate.
import { buildMigratedSchema } from '../scripts/check-d1-trigger-fanout.mjs';
// @ts-expect-error Intentional JavaScript integrity checker.
import { checkGameNameNormalization } from '../scripts/game-name-normalization.mjs';
import { normalizeName } from '../src/shared/nameNormalization';
import { createDatabase } from '../worker/data/database';
import { submissionsRoutes } from '../worker/routes/submissions';
import { gamesRoutes } from '../worker/routes/games';
import type { Env } from '../worker/env';

const targetId = 'game_bgg_460712';
const sourceId = 'identity-duplicate-source';
const userId = 'identity-editor';
const setup = () => {
  const sqlite = buildMigratedSchema();
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.prepare(`INSERT INTO users (id, google_sub, email, email_normalized, created_at, last_login_at)
    VALUES (?, ?, 'identity@example.test', 'identity@example.test', 1, 1)`).run(userId, userId);
  sqlite.prepare("INSERT INTO user_roles (user_id, role, granted_by, granted_at) VALUES (?, 'editor', NULL, 1)").run(userId);
  const queries: string[] = [];
  interface Prepared {
    bind(...values: SQLInputValue[]): Prepared;
    all(): Promise<{ results: unknown[]; meta: { changes: number } }>;
    run(): Promise<{ results: unknown[]; meta: { changes: number } }>;
  }
  const prepare = (sql: string, args: SQLInputValue[] = []): Prepared => ({
    bind: (...values) => prepare(sql, values),
    run: () => prepare(sql, args).all(),
    all: async () => {
      queries.push(sql);
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) return { results: statement.all(...args), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(statement.run(...args).changes) } };
    },
  });
  const gateway = createDatabase({ DB: {
    prepare,
    batch: async (statements: Prepared[]) => {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.all());
        sqlite.exec('COMMIT'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } } as unknown as Pick<Env, 'DB'>);
  const app = new Hono<{ Bindings: Env; Variables: any }>();
  app.use('*', async (context, next) => {
    context.set('user', { id: userId, roles: ['editor'] });
    context.set('database', gateway); await next();
  });
  app.route('/', submissionsRoutes);
  app.route('/', gamesRoutes);
  const env = { WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } } as unknown as Env;
  return { sqlite, gateway, app, env, queries };
};

describe('stored game name identities', () => {
  test('all migrated names and aliases use the same canonical key as live writes', () => {
    const { sqlite } = setup();
    try { expect(() => checkGameNameNormalization(sqlite)).not.toThrow(); }
    finally { sqlite.close(); }
  });

  test('a real submission reuses an imported colon/fullwidth name without creating another game', async () => {
    const { sqlite, app, env } = setup();
    try {
      const before = sqlite.prepare('SELECT COUNT(*) AS count FROM games').get();
      const response = await app.request('https://rules.example/api/submissions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newGame: { displayName: 'Ｍｏｕｎｔａｉｎ　Ｇｏａｔｓ： Ｌｅｇａｃｙ' },
          idempotencyKey: 'canonical-identity-submission', rules: [{ statement: '規則必須保留。' }] }),
      }, env);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ gameId: targetId, gameCreated: false });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM games').get()).toEqual(before);
      expect(sqlite.prepare('SELECT game_id FROM rules WHERE statement = ?').get('規則必須保留。')).toEqual({ game_id: targetId });
      const resolved = await app.request('https://rules.example/api/games/resolve?name=Mountain%20Goats%3A%20Legacy', {}, env);
      expect(await resolved.json()).toMatchObject({ game: { id: targetId } });
      expect(sqlite.prepare('SELECT display_name FROM games WHERE id = ?').get(targetId)).toEqual({ display_name: 'Mountain Goats: Legacy' });
    } finally { sqlite.close(); }
  });

  test('the existing merge transaction preserves rules, favorites and immediate raw vote targets without replay', async () => {
    const { sqlite, app, env, queries } = setup();
    try {
      sqlite.prepare(`INSERT INTO games (id, slug, display_name, normalized_name, created_at, updated_at, visibility, review_status)
        VALUES (?, 'identity-duplicate-source', 'Mountain Goats: Legacy', ?, 1, 1, 'public', 'pending')`)
        .run(sourceId, normalizeName('Mountain Goats: Legacy'));
      const sourceSubject = `attribute_subject_game:${sourceId}`, targetSubject = `attribute_subject_game:${targetId}`;
      sqlite.prepare(`INSERT OR IGNORE INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
        VALUES (?, 'identity-duplicate-subject', 'game', 'Mountain Goats: Legacy', ?, 1, 1)`).run(sourceSubject, sourceId);
      const response = await app.request('https://rules.example/api/submissions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: sourceId, idempotencyKey: 'merge-identity-rule', rules: [{ statement: '合併後保留的規則。' }] }),
      }, env);
      expect(response.status).toBe(201);
      sqlite.prepare(`INSERT INTO user_game_favorites (user_id, game_id, created_at, seen_rule_updated_at)
        VALUES (?, ?, 1, 5), (?, ?, 2, 7)`).run(userId, sourceId, userId, targetId);
      const insertVote = sqlite.prepare(`INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b, activity_json, session_id, created_at, updated_at)
        VALUES (?, 'attribute_win_method', ?, ?, ?, ?, '[]', 'identity-merge-history', 1, 1)`);
      insertVote.run('identity-vote-a', sourceSubject, 'attribute_subject_game:game_bgg_125', 7, null);
      insertVote.run('identity-vote-b', 'attribute_subject_game:game_bgg_125', sourceSubject, null, 3);
      queries.length = 0;
      const merged = await app.request(`https://rules.example/api/games/${sourceId}/merge`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetGameId: targetId }),
      }, env);
      expect(merged.status).toBe(200);
      expect(await merged.json()).toMatchObject({ ok: true, sourceGameId: sourceId, targetGameId: targetId });
      expect(sqlite.prepare('SELECT merged_into_game_id FROM games WHERE id = ?').get(sourceId)).toEqual({ merged_into_game_id: targetId });
      expect(sqlite.prepare('SELECT game_id FROM rules WHERE statement = ?').get('合併後保留的規則。')).toEqual({ game_id: targetId });
      expect(sqlite.prepare('SELECT game_id, seen_rule_updated_at FROM user_game_favorites WHERE user_id = ?').all(userId))
        .toEqual([{ game_id: targetId, seen_rule_updated_at: 7 }]);
      expect(sqlite.prepare("SELECT subject_a_id FROM attribute_vote_responses WHERE response_id = 'identity-vote-a'").get()).toEqual({ subject_a_id: targetSubject });
      expect(sqlite.prepare("SELECT subject_b_id FROM attribute_vote_responses WHERE response_id = 'identity-vote-b'").get()).toEqual({ subject_b_id: targetSubject });
      expect(queries.some((sql) => /SELECT[\s\S]*?FROM attribute_vote_responses/iu.test(sql))).toBe(false);
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_vote_lock').get()).toEqual({ count: 0 });
      expect(() => checkGameNameNormalization(sqlite)).not.toThrow();
    } finally { sqlite.close(); }
  });
});
