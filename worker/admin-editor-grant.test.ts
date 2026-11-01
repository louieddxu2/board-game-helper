import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import type { AppVariables } from './auth';
import type { Database, DatabaseStatement } from './data/database';
import type { RouteEnv } from './env';
import adminRoutes from './routes/admin';

const setup = ({ userExists = true, candidates = [] as unknown[], roles = ['admin'] } = {}) => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const batches: DatabaseStatement[][] = [];
  const database: Database = {
    statement(sql: string): DatabaseStatement {
      const call = { sql, values: [] as unknown[] };
      calls.push(call);
      return {
        bind(...values: unknown[]) { call.values = values; return this; },
        first: async <T>() => (sql.includes('SELECT id FROM users WHERE id = ?') && userExists ? { id: 'user-2' } as T : null),
        all: async <T>() => ({ success: true, results: (sql.includes('FROM users u') ? candidates : []) as T[] }),
        run: async <T>() => ({ success: true, results: [] as T[] }),
      };
    },
    batch: async (statements) => { batches.push(statements); return []; },
  };
  const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('database', database);
    c.set('user', { id: 'admin-1', roles: roles as Array<'admin' | 'editor'> });
    await next();
  });
  app.route('/', adminRoutes);
  return { app, calls, batches };
};

const grant = (app: Hono<{ Bindings: RouteEnv; Variables: AppVariables }>, body: unknown) => app.request('/api/admin/editors/user-2/grant', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('direct editor grants', () => {
  test('lists signed-in accounts without an active role with their rule counts', async () => {
    const { app, calls } = setup({ candidates: [{ id: 'user-2', masked_email: 'y***o@gmail.com', nickname: '芋頭', display_name: null, last_login_at: 5, rule_count: 10, pending_rule_count: 2 }] });

    const response = await app.request('/api/admin/editors');

    expect(response.status).toBe(200);
    expect((await response.json() as { candidates: unknown[] }).candidates).toEqual([
      { id: 'user-2', maskedEmail: 'y***o@gmail.com', nickname: '芋頭', ruleCount: 10, pendingRuleCount: 2, lastLoginAt: 5 },
    ]);
    const query = calls.find((call) => call.sql.includes('FROM users u'));
    expect(query?.sql).toContain('NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.revoked_at IS NULL)');
    expect(query?.sql).toContain('LIMIT 50');
    expect(query?.values).toEqual(['usr_deleted']);
  });

  test('grants the role by account id and invalidates attribute replay in the same batch', async () => {
    const { app, calls, batches } = setup();

    const response = await grant(app, { role: 'editor' });

    expect(response.status).toBe(200);
    expect(batches).toHaveLength(1);
    const insertIndex = calls.findIndex((call) => call.sql.includes('INSERT INTO user_roles'));
    expect(calls[insertIndex].values.slice(0, 3)).toEqual(['user-2', 'editor', 'admin-1']);
    expect(calls[insertIndex].sql).toContain('ON CONFLICT(user_id, role) DO UPDATE SET revoked_at = NULL');
    expect(calls[insertIndex + 1].sql).toContain('UPDATE attribute_replay_status');
  });

  test('rejects unknown accounts and roles without writing', async () => {
    const missing = setup({ userExists: false });
    expect((await grant(missing.app, { role: 'editor' })).status).toBe(404);
    expect(missing.batches).toHaveLength(0);

    const invalid = setup();
    expect((await grant(invalid.app, { role: 'owner' })).status).toBe(400);
    expect(invalid.batches).toHaveLength(0);
  });

  test('is limited to admins', async () => {
    const { app, batches } = setup({ roles: ['editor'] });
    expect((await grant(app, { role: 'editor' })).status).toBe(403);
    expect(batches).toHaveLength(0);
  });
});
