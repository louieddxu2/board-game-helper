import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import type { AppVariables } from './auth';
import type { Database, DatabaseStatement } from './data/database';
import type { RouteEnv } from './env';
import adminRoutes from './routes/admin';

describe('editor invitations', () => {
  test('uses a non-email placeholder for the legacy required field', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const database: Database = {
      statement(sql: string): DatabaseStatement {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        return {
          bind(...values: unknown[]) { call.values = values; return this; },
          first: async <T>() => null as T | null,
          all: async <T>() => ({ success: true, results: [] as T[] }),
          run: async <T>() => ({ success: true, results: [] as T[] }),
        };
      },
      batch: async () => [],
    };
    const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('database', database);
      c.set('user', { id: 'admin-1', roles: ['admin'] });
      await next();
    });
    app.route('/', adminRoutes);

    const response = await app.request('/api/admin/editors/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Editor@Example.com', role: 'editor', note: '測試' }),
    }, { EMAIL_HASH_SECRET: 'test-email-hmac-secret-at-least-32-characters' });

    expect(response.status).toBe(200);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO editor_invitations'));
    expect(insert?.sql).toContain('email_normalized, email_hash, masked_email');
    expect(insert?.sql).toContain('ON CONFLICT(email_hash)');
    expect(insert?.values[1]).toMatch(/^redacted-invite:invite_/);
    expect(insert?.values).not.toContain('editor@example.com');
    expect(insert?.values[2]).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(insert?.values[3]).toBe('e***r@example.com');
  });

  test('refuses to revoke the final active admin role', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const database: Database = {
      statement(sql: string): DatabaseStatement {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        return {
          bind(...values: unknown[]) { call.values = values; return this; },
          first: async <T>() => (sql.includes('user_id = ?') ? { present: 1 } as T : null),
          all: async <T>() => ({ success: true, results: [] as T[] }),
          run: async <T>() => ({ success: true, results: [] as T[] }),
        };
      },
      batch: async () => [],
    };
    const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('database', database);
      c.set('user', { id: 'admin-1', roles: ['admin'] });
      await next();
    });
    app.route('/', adminRoutes);

    const response = await app.request('/api/admin/editors/admin-1?role=admin', {
      method: 'DELETE', body: '{}', headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'last_admin_role' });
    expect(calls.some((call) => call.sql.includes('UPDATE user_roles SET revoked_at'))).toBe(false);
  });
});
