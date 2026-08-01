import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import { DELETED_ACCOUNT_ID, deleteAccount, queryAccountDeletionSummary } from './data/accountDeletion';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(), all: vi.fn(), run: vi.fn(), ...overrides,
});

describe('account deletion data boundary', () => {
  test('previews only the account creator rows and indexed revision authors', async () => {
    const queries = [
      statement({ first: vi.fn().mockResolvedValue({ total_count: 5, deletable_count: 3 }) }),
      statement({ first: vi.fn().mockResolvedValue({ present: 1 }) }),
      statement({ first: vi.fn().mockResolvedValue(null) }),
    ];
    const db = { statement: vi.fn().mockImplementation(() => queries.shift()), batch: vi.fn() } as unknown as Database;

    await expect(queryAccountDeletionSummary(db, 'u1')).resolves.toEqual({
      deletableRuleCount: 3, retainedRuleCount: 2, isLastAdmin: true,
    });
    const sql = vi.mocked(db.statement).mock.calls.map(([query]) => query).join('\n');
    expect(sql).toMatch(/r\.created_by = \?/);
    expect(sql).toMatch(/rr\.rule_id = r\.id AND rr\.edited_by <> \?/);
    expect(sql).toMatch(/role = 'admin'.*user_id <> \?/s);
  });

  test('does not issue any rule delete when the optional checkbox is off', async () => {
    const db = {
      statement: vi.fn().mockImplementation(() => statement()),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    await expect(deleteAccount(db, 'u1', false)).resolves.toEqual({ deletedRuleCount: 0 });
    const sql = vi.mocked(db.statement).mock.calls.map(([query]) => query);
    expect(sql.some((query) => /^\s*DELETE FROM rules/m.test(query))).toBe(false);
    expect(sql).toContain('DELETE FROM users WHERE id = ?');
  });

  test('rechecks other revision authors inside the optional rule delete batch', async () => {
    const db = {
      statement: vi.fn().mockImplementation(() => statement()),
      batch: vi.fn().mockResolvedValue([{ meta: { changes: 4 } }]),
    } as unknown as Database;

    await expect(deleteAccount(db, 'u1', true)).resolves.toEqual({ deletedRuleCount: 4 });
    const deleteSql = vi.mocked(db.statement).mock.calls[0][0];
    expect(deleteSql).toMatch(/DELETE FROM rules/);
    expect(deleteSql).toMatch(/NOT EXISTS[\s\S]*rr\.edited_by <> \?/);
    const firstStatement = vi.mocked(db.statement).mock.results[0].value as DatabaseStatement;
    expect(firstStatement.bind).toHaveBeenCalledWith('u1', 'u1');
  });

  test('anonymizes every retained author reference before deleting the user', async () => {
    const db = {
      statement: vi.fn().mockImplementation(() => statement()),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    await deleteAccount(db, 'u1', false);
    const calls = vi.mocked(db.statement).mock.calls.map(([query]) => query).join('\n');
    expect(calls).toContain('UPDATE rule_revisions SET edited_by = ? WHERE edited_by = ?');
    expect(calls).toContain('UPDATE review_batches SET created_by = ? WHERE created_by = ?');
    expect(calls).toContain('UPDATE rules SET reviewed_by = ?, reviewed_by_nickname = ? WHERE reviewed_by = ?');
    expect(calls).toContain('UPDATE games SET reviewed_by = ?, reviewed_by_nickname = ? WHERE reviewed_by = ?');
    expect(calls).toContain('private_note = NULL, idempotency_key = NULL');
    expect(calls).toContain('DELETE FROM users WHERE id = ?');
    expect(DELETED_ACCOUNT_ID).toBe('usr_deleted');
  });
});
