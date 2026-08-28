import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './database';
import { ensureRuleGameVariantStatements } from './gameEntities';

const fakeDatabase = (existing: Array<{ game_id: string; normalized_name: string; entity_kind: 'expansion' | 'version' }> = []) => {
  const statements: Array<DatabaseStatement & { sql: string; bindings: unknown[] }> = [];
  const statement = (sql: string) => {
    const item = {
      sql,
      bindings: [] as unknown[],
      bind: vi.fn((...values: unknown[]) => { item.bindings = values; return item; }),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: sql.includes('FROM game_entity_relations') ? existing : [], meta: {} })),
      run: vi.fn(async () => ({ results: [], meta: {} })),
    } as DatabaseStatement & { sql: string; bindings: unknown[] };
    statements.push(item);
    return item;
  };
  return { db: { statement, batch: vi.fn(async () => []) } as unknown as Database, statements };
};

describe('game entity promotion', () => {
  test('ignores ambiguous labels and creates deterministic variant statements', async () => {
    const first = fakeDatabase();
    const second = fakeDatabase();
    const labels = ['挪威人擴充', '第二版', 'Promo'];

    const firstStatements = await ensureRuleGameVariantStatements(first.db, 'game-1', 'rule-1', labels, 100);
    const secondStatements = await ensureRuleGameVariantStatements(second.db, 'game-1', 'rule-2', labels, 100);

    expect(firstStatements).toHaveLength(6);
    expect(firstStatements.filter((item) => item.sql.includes('INSERT OR IGNORE INTO games'))).toHaveLength(2);
    expect(firstStatements.filter((item) => item.sql.includes('INSERT OR IGNORE INTO rule_game_variants'))).toHaveLength(2);
    expect(firstStatements[0].bindings[0]).toBe(secondStatements[0].bindings[0]);
    expect(firstStatements[2].bindings[1]).toBe(secondStatements[2].bindings[1]);
  });

  test('reuses an existing entity without creating another game row', async () => {
    const { db, statements } = fakeDatabase([
      { game_id: 'variant-1', normalized_name: '挪威人擴', entity_kind: 'expansion' },
    ]);

    const result = await ensureRuleGameVariantStatements(db, 'game-1', 'rule-1', ['挪威人擴充'], 100);

    expect(result).toHaveLength(1);
    expect(result[0].sql).toContain('rule_game_variants');
    expect(statements.some((item) => item.sql.includes('INSERT OR IGNORE INTO games'))).toBe(false);
  });
});
