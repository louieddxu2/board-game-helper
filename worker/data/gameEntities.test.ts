import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './database';
import { ensureRuleGameVariantStatements } from './gameEntities';

const fakeDatabase = (existing: Array<{ game_id: string; normalized_name: string; entity_kind: 'expansion' | 'version' | 'unknown' }> = []) => {
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
  test('keeps ambiguous labels as unclassified variant entities', async () => {
    const first = fakeDatabase();
    const second = fakeDatabase();
    const labels = ['挪威人擴充', '第二版', 'Promo'];

    const firstStatements = await ensureRuleGameVariantStatements(first.db, 'game-1', 'rule-1', labels, 100);
    const secondStatements = await ensureRuleGameVariantStatements(second.db, 'game-1', 'rule-2', labels, 100);
    const firstDetails = firstStatements as unknown as Array<{ sql: string; bindings: unknown[] }>;
    const secondDetails = secondStatements as unknown as Array<{ sql: string; bindings: unknown[] }>;

    expect(firstDetails).toHaveLength(9);
    expect(firstDetails.filter((item) => item.sql.includes('INSERT OR IGNORE INTO games'))).toHaveLength(3);
    expect(firstDetails.filter((item) => item.sql.includes('INSERT OR IGNORE INTO rule_game_variants'))).toHaveLength(3);
    expect(firstDetails.filter((item) => item.sql.includes('INSERT OR IGNORE INTO game_entity_relations'))).toHaveLength(3);
    expect(firstDetails[0].bindings[0]).toBe(secondDetails[0].bindings[0]);
    expect(firstDetails[2].bindings[1]).toBe(secondDetails[2].bindings[1]);
    expect(firstDetails[6].bindings[6]).toBe('unknown');
    expect(firstDetails[7].bindings[3]).toBe('variant_of');
  });

  test('reuses an existing entity without creating another game row', async () => {
    const { db, statements } = fakeDatabase([
      { game_id: 'variant-1', normalized_name: '挪威人擴', entity_kind: 'expansion' },
    ]);

    const result = await ensureRuleGameVariantStatements(db, 'game-1', 'rule-1', ['挪威人擴充'], 100);
    const details = statements as Array<{ sql: string; bindings: unknown[] }>;

    expect(result).toHaveLength(1);
    expect((result[0] as unknown as { sql: string }).sql).toContain('rule_game_variants');
    expect(details.some((item) => item.sql.includes('INSERT OR IGNORE INTO games'))).toBe(false);
  });

  test('reuses an existing unclassified entity', async () => {
    const { db, statements } = fakeDatabase([
      { game_id: 'variant-unknown', normalized_name: 'promo', entity_kind: 'unknown' },
    ]);

    const result = await ensureRuleGameVariantStatements(db, 'game-1', 'rule-1', ['Promo'], 100);
    const details = statements as Array<{ sql: string; bindings: unknown[] }>;

    expect(result).toHaveLength(1);
    expect((result[0] as unknown as { sql: string }).sql).toContain('rule_game_variants');
    expect(details.some((item) => item.sql.includes('INSERT OR IGNORE INTO games'))).toBe(false);
  });
});
