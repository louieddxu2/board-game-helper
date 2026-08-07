import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import type { SessionUser } from '../src/shared/types';
import type { Database, DatabaseStatement } from './data/database';
import type { Env } from './env';
import { rulePatchSchema } from './routes/rules';
import { rulesRoutes } from './routes/rules';

const row = {
  id: 'rule-1', submission_id: 'sub-1', game_id: 'game-1', statement: '原始規則', common_mistake: null,
  details: null, flow_stage: 'setup', categories_json: '[]', player_counts_json: '[]', edition_notes_json: '[]',
  edition_note: null, source_label: null, source_url: 'https://example.com/rules', status: 'published',
  created_by: 'ordinary-1', created_at: 1, updated_at: 100, editor_ids_json: '[]', importance_count: 0,
  tag_ids_json: '[]', review_status: 'reviewed', reviewed_by: 'editor-1', reviewed_by_nickname: '編輯', reviewed_at: 90,
  game_name: '測試遊戲', game_slug: 'test-game',
};

const fakeDatabase = (pendingRuleCount = 0, rejectPendingRuleLimit = false) => {
  const statements: Array<DatabaseStatement & { sql: string; bindings: unknown[] }> = [];
  const statement = (sql: string) => {
    const item = {
      sql,
      bindings: [] as unknown[],
      bind: vi.fn((...values: unknown[]) => { item.bindings = values; return item; }),
      first: vi.fn(async <T>() => {
        if (sql.includes('SELECT r.* FROM rules')) return row as T;
        if (sql.includes('SELECT id, batch_id, version, base_updated_at')) return null as T;
        if (sql.includes('COUNT(*) count FROM rules')) return { count: pendingRuleCount } as T;
        if (sql.includes('COUNT(*) count FROM games')) return { count: 0 } as T;
        if (sql.includes('COUNT(*) count FROM review_proposals')) return { count: 0 } as T;
        if (sql.includes('SELECT r.*, g.display_name')) return { ...row, review_status: 'pending', pending_review_by: 'ordinary-1' } as T;
        return null as T;
      }),
      all: vi.fn(async () => ({ results: [], meta: {} })),
      run: vi.fn(async () => {
        if (rejectPendingRuleLimit && sql.includes('UPDATE rules SET')) throw new Error('D1_ERROR: pending_rule_limit');
        return { results: [], meta: sql.includes('UPDATE rules SET') ? { changes: 1 } : {} };
      }),
    } as DatabaseStatement & { sql: string; bindings: unknown[] };
    statements.push(item);
    return item;
  };
  const batch = vi.fn(async () => []);
  return { db: { statement, batch } as unknown as Database, statements, batch };
};

const appFor = (user: SessionUser, db: Database) => {
  const app = new Hono<{ Bindings: Env; Variables: any }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('database', db); await next(); });
  app.route('/', rulesRoutes);
  return app;
};

describe('rule mutation URL validation', () => {
  test('accepts HTTPS sources only', () => {
    expect(rulePatchSchema.safeParse({ sourceUrl: 'https://example.com/rules' }).success).toBe(true);
    expect(rulePatchSchema.safeParse({ sourceUrl: 'http://example.com/rules' }).success).toBe(false);
    expect(rulePatchSchema.safeParse({ sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(rulePatchSchema.safeParse({ sourceUrl: '' }).success).toBe(true);
  });

  test('applies an ordinary reviewed-rule edit and marks the row pending', async () => {
    const { db, batch, statements } = fakeDatabase();
    vi.stubGlobal('caches', { default: { delete: vi.fn(async () => true) } });
    const response = await appFor({ id: 'ordinary-1', roles: [] }, db).request('https://rules.example/api/rules/rule-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ statement: '修正後規則' }),
    }, { WRITE_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } } as unknown as Env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, reviewStatus: 'pending' });
    expect(batch).toHaveBeenCalledOnce();
    const batchCalls = batch.mock.calls as unknown as Array<[Array<DatabaseStatement & { sql?: string }>] >;
    const batchedStatements = batchCalls[0]?.[0] ?? [];
    const update = statements.find((item) => item.sql.includes('UPDATE rules SET'));
    expect(update?.sql).toContain("review_status = 'pending'");
    expect(update?.sql).toContain('pending_review_by = ?');
    expect(batchedStatements.some((item) => item.sql?.includes('review_proposals'))).toBe(false);
    expect(batchedStatements.some((item) => item.sql?.includes('review_batches'))).toBe(false);
    expect((update as (DatabaseStatement & { bindings?: unknown[] }) | undefined)?.bindings).toContain('ordinary-1');
    vi.unstubAllGlobals();
  });

  test('rejects an ordinary user editing a rule created by someone else', async () => {
    const { db, batch } = fakeDatabase();
    const response = await appFor({ id: 'ordinary-2', roles: [] }, db).request('https://rules.example/api/rules/rule-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUpdatedAt: 100, statement: 'not allowed' }),
    }, { WRITE_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } } as unknown as Env);

    expect(response.status).toBe(403);
    expect(batch).not.toHaveBeenCalled();
  });

  test('rejects a stale editor tab before writing', async () => {
    const { db, batch } = fakeDatabase();
    const response = await appFor({ id: 'ordinary-1', roles: [] }, db).request('https://rules.example/api/rules/rule-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUpdatedAt: 99, statement: 'stale' }),
    }, { WRITE_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } } as unknown as Env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'rule_changed_while_editing', currentUpdatedAt: 100 });
    expect(batch).not.toHaveBeenCalled();
  });

  test('rejects an edit when the contributor has no pending-rule quota left', async () => {
    const { db, batch } = fakeDatabase(6);
    const response = await appFor({ id: 'ordinary-1', roles: [] }, db).request('https://rules.example/api/rules/rule-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUpdatedAt: 100, statement: 'quota exhausted' }),
    }, { WRITE_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } } as unknown as Env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'PENDING_RULE_LIMIT_REACHED' });
    expect(batch).not.toHaveBeenCalled();
  });

  test('maps a concurrent quota trigger rejection to the quota error', async () => {
    const { db, batch } = fakeDatabase(5, true);
    const response = await appFor({ id: 'ordinary-1', roles: [] }, db).request('https://rules.example/api/rules/rule-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUpdatedAt: 100, statement: 'concurrent quota claim' }),
    }, { WRITE_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } } as unknown as Env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'PENDING_RULE_LIMIT_REACHED' });
    expect(batch).not.toHaveBeenCalled();
  });
});
