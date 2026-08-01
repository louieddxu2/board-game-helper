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
    });

    expect(response.status).toBe(200);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO editor_invitations'));
    expect(insert?.sql).toContain('email_normalized, email_hash, masked_email');
    expect(insert?.values[1]).toMatch(/^redacted-invite:invite_/);
    expect(insert?.values).not.toContain('editor@example.com');
    expect(insert?.values[3]).toBe('e***r@example.com');
  });
});
