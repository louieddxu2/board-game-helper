import { Hono } from 'hono';
import { describe, expect, test, vi } from 'vitest';
import type { SessionUser } from '../src/shared/types';
import type { Database, DatabaseStatement } from './data/database';
import type { Env } from './env';
import { authRoutes } from './routes/auth';
import { contributionRoutes } from './routes/contributions';

type Recorded = DatabaseStatement & { sql: string; bindings: unknown[] };

const fakeDatabase = () => {
  const recorded: Recorded[] = [];
  const statement = (sql: string): Recorded => {
    const item: Recorded = {
      sql,
      bindings: [],
      bind: vi.fn((...values: unknown[]) => { item.bindings = values; return item; }),
      first: vi.fn(async () => null),
      all: vi.fn(async () => {
        if (sql.includes('FROM rules r') && sql.includes("r.review_status = 'pending'")) {
          return { results: [{
            id: 'rule-1', game_id: 'game-1', game_name: '範例遊戲', game_slug: 'example',
            statement: '待審核規則', status: 'published', review_status: 'pending', created_at: 1, updated_at: 1,
          }] };
        }
        if (sql.includes('FROM games g') && sql.includes("g.review_status = 'pending'")) {
          return { results: [{
            id: 'game-1', slug: 'example', display_name: '範例遊戲', visibility: 'public',
            review_status: 'pending', merged_into_game_id: null, created_at: 1, updated_at: 1,
          }] };
        }
        if (sql.includes('FROM rules r') && sql.includes('r.created_by = ?')) {
          return { results: [{
            id: 'rule-reviewed', game_name: '已審核遊戲', game_slug: 'reviewed', statement: '已審核規則',
            status: 'published', created_at: 1, updated_at: 1,
          }] };
        }
        return { results: [] };
      }) as unknown as DatabaseStatement['all'],
      run: vi.fn(async () => ({ results: [] })),
    };
    recorded.push(item);
    return item;
  };
  return { db: { statement, batch: vi.fn() } as unknown as Database, recorded };
};

const appFor = (user: SessionUser, db: Database) => {
  const app = new Hono<{ Bindings: Env; Variables: any }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('database', db); await next(); });
  app.route('/', authRoutes);
  app.route('/', contributionRoutes);
  return app;
};

describe('account read routes', () => {
  test('loads only bounded pending submissions with two D1 queries', async () => {
    const { db, recorded } = fakeDatabase();
    const app = appFor({ id: 'user-1', roles: [] }, db);

    const response = await app.request('https://rules.example/api/account/contributions');
    const payload = await response.json() as { rules: unknown[]; games: unknown[]; quota: { pendingRules: number; pendingGames: number } };

    expect(response.status).toBe(200);
    expect(recorded).toHaveLength(2);
    expect(recorded.every((query) => !query.sql.includes('COUNT('))).toBe(true);
    expect(recorded[0].sql).toContain("r.review_status = 'pending' AND r.status = 'published'");
    expect(recorded[0].sql).toContain('LIMIT 6');
    expect(recorded[1].sql).toContain("g.review_status = 'pending'");
    expect(recorded[1].sql).toContain("g.visibility = 'public'");
    expect(recorded[1].sql).toContain('LIMIT 1');
    expect(payload).toMatchObject({ quota: { pendingRules: 1, pendingGames: 1 } });
    expect(payload.rules).toHaveLength(1);
    expect(payload.games).toHaveLength(1);
  });

  test('does not read history for the base account response', async () => {
    const { db, recorded } = fakeDatabase();
    const app = appFor({ id: 'user-1', roles: [] }, db);

    const response = await app.request('https://rules.example/api/account');

    expect(response.status).toBe(200);
    expect(recorded).toHaveLength(0);
  });

  test('includes a general user\'s hidden rules in creation history after expansion', async () => {
    const { db, recorded } = fakeDatabase();
    const app = appFor({ id: 'user-1', roles: [] }, db);

    const response = await app.request('https://rules.example/api/account/created-rules');

    expect(response.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].sql).toContain("r.review_status = 'reviewed' OR r.status = 'hidden'");
    expect(recorded[0].sql).toContain('LIMIT 20');
    expect(recorded[0].bindings).toEqual(['user-1']);
  });

  test('allows a general user to read their own modification history', async () => {
    const { db, recorded } = fakeDatabase();
    const response = await appFor({ id: 'user-1', roles: [] }, db).request('https://rules.example/api/account/modified-rules');

    expect(response.status).toBe(200);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].sql).toContain('FROM rule_revisions rr');
    expect(recorded[0].sql).toContain('WHERE r.created_by = ?');
    expect(recorded[0].bindings).toEqual(['user-1', 'user-1']);
  });
});
