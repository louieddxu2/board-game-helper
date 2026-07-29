import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import { queryUserRuleImportance, setRuleImportance } from './data/ruleImportance';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(), all: vi.fn(), run: vi.fn(), ...overrides,
});

describe('rule importance data boundary', () => {
  test('reads only the signed-in user votes for one game through the composite key', async () => {
    const query = statement({ all: vi.fn().mockResolvedValue({ results: [{ rule_id: 'r1' }, { rule_id: 'r3' }] }) });
    const db = { statement: vi.fn().mockReturnValue(query), batch: vi.fn() } as unknown as Database;

    await expect(queryUserRuleImportance(db, 'u1', 'g1')).resolves.toEqual({ ruleIds: ['r1', 'r3'] });
    expect(db.statement).toHaveBeenCalledWith(expect.stringMatching(/WHERE user_id = \? AND game_id = \?/));
    expect(query.bind).toHaveBeenCalledWith('u1', 'g1');
  });

  test('uses an idempotent unique insert and one aggregate-row read', async () => {
    const write = statement({ run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }) });
    const read = statement({ first: vi.fn().mockResolvedValue({ importance_count: 7 }) });
    const db = { statement: vi.fn().mockReturnValueOnce(write).mockReturnValueOnce(read), batch: vi.fn() } as unknown as Database;

    await expect(setRuleImportance(db, 'u1', 'r1', true, 123)).resolves.toEqual({ important: true, count: 7 });
    expect(db.statement).toHaveBeenNthCalledWith(1, expect.stringMatching(/ON CONFLICT\(user_id, rule_id\) DO NOTHING/));
    expect(write.bind).toHaveBeenCalledWith('u1', 123, 'r1');
    expect(db.statement).toHaveBeenCalledTimes(2);
  });

  test('removes by the unique user-rule key and reports a missing or hidden rule', async () => {
    const remove = statement({ run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }) });
    const read = statement({ first: vi.fn().mockResolvedValue(null) });
    const db = { statement: vi.fn().mockReturnValueOnce(remove).mockReturnValueOnce(read), batch: vi.fn() } as unknown as Database;

    await expect(setRuleImportance(db, 'u1', 'r1', false, 123)).resolves.toBeNull();
    expect(remove.bind).toHaveBeenCalledWith('u1', 'r1');
  });
});
