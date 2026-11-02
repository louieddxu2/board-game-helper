import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import type { AppVariables } from './auth';
import type { Database, DatabaseStatement } from './data/database';
import type { RouteEnv } from './env';
import { authRoutes } from './routes/auth';

const setup = (user: AppVariables['user']) => {
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
    if (user) c.set('user', user);
    await next();
  });
  app.route('/', authRoutes);
  const patch = (body: unknown) => app.request('/api/account/nickname', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { patch, calls };
};

describe('account nickname', () => {
  test('lets any signed-in contributor set and hide a nickname', async () => {
    const { patch, calls } = setup({ id: 'user-1', roles: [] });

    const response = await patch({ nickname: '小東', showNickname: false });

    expect(response.status).toBe(200);
    expect((await response.json() as { user: unknown }).user).toEqual(expect.objectContaining({ nickname: '小東', showNickname: false }));
    const update = calls.find((call) => call.sql.startsWith('UPDATE users SET nickname'));
    expect(update?.values).toEqual(['小東', expect.any(String), 0, 'user-1']);
  });

  test('still requires a signed-in account', async () => {
    const { patch, calls } = setup(undefined);

    expect((await patch({ nickname: '小東', showNickname: true })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

});
