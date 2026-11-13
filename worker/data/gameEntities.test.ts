import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './database';
import { ensureRuleGameVariantStatements } from './gameEntities';

const fakeDatabase = (existing: Array<{ game_id: string; name: string }> = []) => {
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
  test('stores a canonical name key separately from expansion-label equivalence', async () => {
    const { db, statements } = fakeDatabase();
    await ensureRuleGameVariantStatements(db, 'game-1', 'rule-1', ['1.1 擴充'], 100);
    expect(statements.find((item) => item.sql.includes('INSERT OR IGNORE INTO games'))?.bindings[3]).toBe('11擴充');
  });

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
      { game_id: 'variant-1', name: '挪威人擴' },
    ]);

    const result = await ensureRuleGameVariantStatements(db, 'game-1', 'rule-1', ['挪威人擴充'], 100);
    const details = statements as Array<{ sql: string; bindings: unknown[] }>;

    expect(result).toHaveLength(1);
    expect((result[0] as unknown as { sql: string }).sql).toContain('rule_game_variants');
    expect(details.some((item) => item.sql.includes('INSERT OR IGNORE INTO games'))).toBe(false);
  });

  test('reuses an existing unclassified entity', async () => {
    const { db, statements } = fakeDatabase([
      { game_id: 'variant-unknown', name: 'Promo' },
    ]);

    const result = await ensureRuleGameVariantStatements(db, 'game-1', 'rule-1', ['Promo'], 100);
    const details = statements as Array<{ sql: string; bindings: unknown[] }>;

    expect(result).toHaveLength(1);
    expect((result[0] as unknown as { sql: string }).sql).toContain('rule_game_variants');
    expect(details.some((item) => item.sql.includes('INSERT OR IGNORE INTO games'))).toBe(false);
  });

  test('links an imported expansion by its own name or alias even without an expansion marker', async () => {
    const { db, statements } = fakeDatabase([
      { game_id: 'game_bgg_338013', name: '馬拉開波：起義' },
      { game_id: 'game_bgg_338013', name: 'Maracaibo: The Uprising' },
    ]);

    const result = await ensureRuleGameVariantStatements(db, 'game-1', 'rule-1', ['馬拉開波：起義', 'Maracaibo: The Uprising'], 100);

    expect(statements.some((item) => item.sql.includes('INSERT OR IGNORE INTO games'))).toBe(false);
    expect(result.map((item) => (item as unknown as { bindings: unknown[] }).bindings[1])).toEqual(['game_bgg_338013']);
  });
});
