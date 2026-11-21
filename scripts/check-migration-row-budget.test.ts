// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_MIGRATION_ROW_BUDGET, checkMigrationRowBudget, migrationRowBudget, rowBudgetViolations, splitSqlStatements,
} from './check-migration-row-budget.mjs';

describe('migration row budget', () => {
  test('splits statements but keeps trigger bodies, CASE expressions, strings and comments whole', () => {
    const sql = `-- leading; comment
CREATE TABLE a (id TEXT); /* block; comment */
CREATE TRIGGER t AFTER UPDATE ON a BEGIN
  UPDATE a SET id = CASE WHEN NEW.id = ';' THEN 'x' ELSE 'y' END;
  DELETE FROM a WHERE id = 'it''s; fine';
END;
UPDATE a SET id = CASE id WHEN 'a' THEN 'b' END;
`;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('CREATE TABLE a (id TEXT);');
    expect(statements[1]).toMatch(/^\/\* block; comment \*\/\s+CREATE TRIGGER t[\s\S]*'it''s; fine';\s+END;$/u);
    expect(statements[2]).toBe("UPDATE a SET id = CASE id WHEN 'a' THEN 'b' END;");
  });

  test('uses the default budget unless a migration declares its cost and reason', () => {
    expect(migrationRowBudget('UPDATE games SET slug = slug;')).toEqual(DEFAULT_MIGRATION_ROW_BUDGET);
    expect(migrationRowBudget('-- d1-row-budget: reads=50000 writes=4000 reason=rename every imported game once\nUPDATE games SET slug = slug;'))
      .toEqual({ reads: 50000, writes: 4000, reason: 'rename every imported game once' });
    // A budget without a reason is not a declaration.
    expect(migrationRowBudget('-- d1-row-budget: reads=50000 writes=4000\n')).toEqual(DEFAULT_MIGRATION_ROW_BUDGET);
  });

  test('reports reads or writes over the budget', () => {
    const budget = { reads: 100, writes: 10 };
    expect(rowBudgetViolations([
      { name: 'ok.sql', reads: 100, writes: 10, budget },
      { name: 'reads.sql', reads: 101, writes: 0, budget },
      { name: 'writes.sql', reads: 0, writes: 11, budget },
    ]).map((violation) => violation.split(':')[0])).toEqual(['reads.sql', 'writes.sql']);
  });

  // Migration 0133 compared every renamed game with every other through an unindexed table and
  // read about 146k production rows. Measured on the imported data, it must be refused.
  test('refuses migration 0133 and passes migration 0132 on the imported data', async () => {
    await expect(checkMigrationRowBudget(['0132_six_pending_games.sql'])).resolves.toEqual([
      expect.objectContaining({ name: '0132_six_pending_games.sql', budget: DEFAULT_MIGRATION_ROW_BUDGET }),
    ]);
    await expect(checkMigrationRowBudget(['0133_name_based_bgg_slugs.sql'])).rejects.toThrow(/0133_name_based_bgg_slugs\.sql: read \d+ rows/u);
  }, 120_000);
});
