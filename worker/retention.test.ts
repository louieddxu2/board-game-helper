import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import { cleanupExpiredSessions } from './data/retention';

const statement = (): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(), all: vi.fn(), run: vi.fn().mockResolvedValue({ meta: { changes: 2 } }),
});

describe('scheduled privacy retention', () => {
  test('removes expired sessions using the existing daily scheduled task', async () => {
    const prepared = statement();
    const db = { statement: vi.fn().mockReturnValue(prepared), batch: vi.fn() } as unknown as Database;

    await cleanupExpiredSessions(db, 12345);

    expect(db.statement).toHaveBeenCalledWith('DELETE FROM sessions WHERE expires_at <= ?');
    expect(prepared.bind).toHaveBeenCalledWith(12345);
    expect(prepared.run).toHaveBeenCalledOnce();
  });
});
