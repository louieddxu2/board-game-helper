import { Hono } from 'hono';
import { expect, test, vi } from 'vitest';
import type { AppVariables } from './auth';
import type { Database, DatabaseStatement } from './data/database';
import type { RouteEnv } from './env';
import { attributesRoutes } from './routes/attributes';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

test('stale attribute snapshot cursors read only snapshot metadata, not delta entries', async () => {
  const snapshotStatement = statement({
    first: vi.fn().mockResolvedValue({ active_generation: 7, generated_at: 1234 }),
  });
  const deltaStatement = statement({
    all: vi.fn().mockRejectedValue(new Error('stale snapshot must not read catalog entries')),
  });
  const db = {
    statement: vi.fn((sql: string) => sql.includes('attribute_catalog_snapshot_state') ? snapshotStatement : deltaStatement),
    batch: vi.fn(),
    metrics: () => ({ rowsRead: 1, rowsWritten: 0, queries: 1 }),
  } as unknown as Database;
  const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
  app.use('*', async (c, next) => { c.set('database', db); await next(); });
  app.route('/', attributesRoutes);

  const response = await app.request('/api/attributes/table/changes?after=42&generation=6&generatedAt=1200');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    changes: [],
    throughVersion: 42,
    hasMore: false,
    snapshot: { generation: 7, generatedAt: 1234 },
  });
  expect(response.headers.get('X-D1-Rows-Read')).toBe('1');
  expect(db.statement).toHaveBeenCalledTimes(1);
  expect(deltaStatement.all).not.toHaveBeenCalled();
});

test('attribute delta cursors require the snapshot identity after retention is enabled', async () => {
  const db = {
    statement: vi.fn(),
    batch: vi.fn(),
    metrics: () => ({ rowsRead: 0, rowsWritten: 0, queries: 0 }),
  } as unknown as Database;
  const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
  app.use('*', async (c, next) => { c.set('database', db); await next(); });
  app.route('/', attributesRoutes);

  const response = await app.request('/api/attributes/table/changes?after=42');

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'catalog_snapshot_required' });
  expect(db.statement).not.toHaveBeenCalled();
});
