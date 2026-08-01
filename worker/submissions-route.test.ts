import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import type { SessionUser } from '../src/shared/types';
import type { Database, DatabaseStatement } from './data/database';
import type { Env } from './env';
import { submissionsRoutes } from './routes/submissions';

type Recorded = DatabaseStatement & { sql: string; bindings: unknown[] };

const fakeDatabase = (options: { pendingRules?: number; pendingGames?: number; existingGame?: boolean } = {}) => {
  const recorded: Recorded[] = [];
  const statement = (sql: string): Recorded => {
    const item: Recorded = {
      sql,
      bindings: [],
      bind: vi.fn((...values: unknown[]) => { item.bindings = values; return item; }),
      first: async <T = Record<string, unknown>>() => {
        let result: unknown = null;
        if (sql.includes('COUNT(*) count FROM rules')) result = { count: options.pendingRules ?? 0 };
        else if (sql.includes('COUNT(*) count FROM games')) result = { count: options.pendingGames ?? 0 };
        else if (sql.includes('SELECT id, slug FROM games')) {
          result = options.existingGame === false ? null : { id: 'game-1', slug: 'known-game' };
        }
        return result as T | null;
      },
      all: vi.fn(async () => ({ results: [], meta: {} })),
      run: vi.fn(async () => ({ results: [], meta: {} })),
    };
    recorded.push(item);
    return item;
  };
  let batchedStatements: DatabaseStatement[] = [];
  const batch = vi.fn(async (statements: DatabaseStatement[]) => {
    batchedStatements = statements;
    return [];
  });
  return { db: { statement, batch } as Database, recorded, batch, getBatchedStatements: () => batchedStatements };
};

const appFor = (user: SessionUser, db: Database) => {
  const app = new Hono<{ Bindings: Env; Variables: any }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('database', db); await next(); });
  app.route('/', submissionsRoutes);
  return app;
};

const env = {
  WRITE_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
} as unknown as Env;

describe('contribution submission route', () => {
  test('stores ordinary account rules as pending in one batch', async () => {
    const { db, recorded, batch } = fakeDatabase();
    const app = appFor({ id: 'ordinary', roles: [] }, db);
    const response = await app.request('https://rules.example/api/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gameId: 'game-1', idempotencyKey: 'request-1234',
        rules: [{ statement: 'First' }, { statement: 'Second' }],
      }),
    }, env);

    expect(response.status).toBe(201);
    expect(batch).toHaveBeenCalledOnce();
    const ruleInserts = recorded.filter((item) => item.sql.includes('INSERT INTO rules'));
    expect(ruleInserts).toHaveLength(2);
    expect(ruleInserts.every((item) => item.sql.includes('review_status') && item.bindings.at(-1) === 'pending')).toBe(true);
  });

  test('creates a new game and its first rule in the same database batch', async () => {
    const { db, batch, getBatchedStatements } = fakeDatabase({ existingGame: false });
    const app = appFor({ id: 'ordinary', roles: [] }, db);
    const response = await app.request('https://rules.example/api/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        newGame: { displayName: 'New Game' }, idempotencyKey: 'request-1234',
        rules: [{ statement: 'First' }],
      }),
    }, env);

    expect(response.status).toBe(201);
    expect(batch).toHaveBeenCalledOnce();
    const batched = getBatchedStatements() as Recorded[];
    expect(batched.findIndex((item) => item.sql.includes('INSERT INTO games')))
      .toBeLessThan(batched.findIndex((item) => item.sql.includes('INSERT INTO submissions')));
    expect(batched.some((item) => item.sql.includes('INSERT INTO rules'))).toBe(true);
  });

  test('rejects a batch larger than the account remaining rule quota before writing', async () => {
    const { db, batch } = fakeDatabase({ pendingRules: 5 });
    const app = appFor({ id: 'ordinary', roles: [] }, db);
    const response = await app.request('https://rules.example/api/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gameId: 'game-1', idempotencyKey: 'request-1234',
        rules: [{ statement: 'First' }, { statement: 'Second' }],
      }),
    }, env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'PENDING_RULE_LIMIT_REACHED' });
    expect(batch).not.toHaveBeenCalled();
  });
});
