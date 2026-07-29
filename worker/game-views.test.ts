import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import {
  cleanupGameViewData,
  dailyViewToken,
  isWeeklyCatalogRun,
  recordAnonymousGameView,
  secondsUntilNextUtcDay,
  utcDate,
} from './data/gameViews';
import { gamesRoutes } from './routes/games';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

describe('account-gated anonymous game views', () => {
  test('rejects a view before touching storage when no account is signed in', async () => {
    const response = await gamesRoutes.request('https://rules.example/api/games/g1/view', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  test('reuses a valid token only on the same UTC date', () => {
    const timestamp = Date.parse('2026-07-29T12:00:00.000Z');
    const existing = '2026-07-29.123e4567-e89b-12d3-a456-426614174000';
    expect(dailyViewToken(existing, timestamp)).toEqual({ token: existing, created: false });
    expect(dailyViewToken(existing, timestamp + 24 * 60 * 60 * 1000)).toMatchObject({ created: true });
    expect(secondsUntilNextUtcDay(timestamp)).toBe(12 * 60 * 60);
  });

  test('reports whether the atomic dedup insert was new', async () => {
    const dedup = statement({ run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) });
    const db = { statement: vi.fn().mockReturnValueOnce(dedup), batch: vi.fn() } as unknown as Database;

    await expect(recordAnonymousGameView(db, 'g1', '2026-07-29', 'key', 123)).resolves.toBe(true);
    expect(db.statement).toHaveBeenCalledOnce();

    const duplicate = statement({ run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }) });
    const duplicateDb = { statement: vi.fn().mockReturnValue(duplicate), batch: vi.fn() } as unknown as Database;
    await expect(recordAnonymousGameView(duplicateDb, 'g1', '2026-07-29', 'key', 124)).resolves.toBe(false);
    expect(duplicateDb.statement).toHaveBeenCalledOnce();
  });

  test('cleans identifiers after one day and keeps fourteen UTC dates of aggregate counts', async () => {
    const prepared = [statement(), statement()];
    const db = {
      statement: vi.fn().mockReturnValueOnce(prepared[0]).mockReturnValueOnce(prepared[1]),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Database;
    const timestamp = Date.parse('2026-07-29T16:00:00.000Z');

    await cleanupGameViewData(db, timestamp);

    expect(prepared[0].bind).toHaveBeenCalledWith(timestamp - 24 * 60 * 60 * 1000);
    expect(prepared[1].bind).toHaveBeenCalledWith(utcDate(timestamp - 13 * 24 * 60 * 60 * 1000));
    expect(db.batch).toHaveBeenCalledOnce();
  });

  test('keeps the catalog rebuild on the Sunday UTC run', () => {
    expect(isWeeklyCatalogRun(Date.parse('2026-08-02T16:00:00.000Z'))).toBe(true);
    expect(isWeeklyCatalogRun(Date.parse('2026-08-03T16:00:00.000Z'))).toBe(false);
  });
});
