// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(() => migrationRowBudget('-- d1-row-budget: reads=999999999999999999999 writes=1 reason=invalid bound'))
      .toThrow('safe integers');
  });

  test('reports reads or writes over the budget', () => {
    const budget = { reads: 100, writes: 10 };
    expect(rowBudgetViolations([
      { name: 'ok.sql', reads: 100, writes: 10, budget },
      { name: 'reads.sql', reads: 101, writes: 0, budget },
      { name: 'writes.sql', reads: 0, writes: 11, budget },
    ]).map((violation) => violation.split(':')[0])).toEqual(['reads.sql', 'writes.sql']);
  });

  test('rejects growth below the absolute budget; declared bulk work must still fit both samples', () => {
    const sample = {
      name: 'batch.sql', reads: 100, writes: 10, budget: { reads: 1000, writes: 100 },
      growth: { reads: 900, writes: 10, subjects: 2000, scores: 4000 },
    };
    expect(rowBudgetViolations([sample])).toEqual([expect.stringContaining('reads grow')]);
    expect(rowBudgetViolations([{ ...sample, growth: { ...sample.growth, reads: 100, writes: 500 } }]))
      .toEqual(expect.arrayContaining([expect.stringContaining('writes grow')]));
    expect(rowBudgetViolations([{ ...sample, budget: { ...sample.budget, reason: 'intentional bulk update' } }])).toEqual([]);
    expect(rowBudgetViolations([{ ...sample, budget: { reads: 800, writes: 100, reason: 'intentional bulk update' } }]))
      .toEqual([expect.stringContaining('read 900 rows (budget 800)')]);
  });

  test('fails closed when a pending migration is missing, even alongside a known migration', async () => {
    await expect(checkMigrationRowBudget(['0132_six_pending_games.sql', 'missing.sql']))
      .rejects.toThrow('Unknown pending migrations: missing.sql');
  });

  // Migration 0133 compared every renamed game with every other through an unindexed table and
  // read about 146k production rows. Measured on the imported data, it must be refused.
  test('refuses migration 0133 and passes migration 0132 on the imported data', async () => {
    await expect(checkMigrationRowBudget(['0132_six_pending_games.sql'])).resolves.toEqual([
      expect.objectContaining({ name: '0132_six_pending_games.sql', budget: DEFAULT_MIGRATION_ROW_BUDGET }),
    ]);
    await expect(checkMigrationRowBudget(['0133_name_based_bgg_slugs.sql'])).rejects.toThrow(/0133_name_based_bgg_slugs\.sql: read \d+ rows/u);
  }, 120_000);

  test('catches both 0134 catalog scans and accepts indexed lookups driven by the 30 approved subjects', async () => {
    const name = '0134_seed_reviewed_risk_and_luck_ratings.sql';
    // This historical SQL passed the old gate (1536 reads), then read about 7k in production.
    // Exercise the real entry point without modifying the published migration.
    await expect(checkMigrationRowBudget([name])).rejects.toThrow(/reads grow with unrelated catalog data/u);
    const directory = mkdtempSync(join(tmpdir(), 'migration-cost-regression-'));
    try {
      cpSync('migrations', directory, { recursive: true });
      const original = readFileSync(join(directory, name), 'utf8');
      const subjectLookup = original.replace('JOIN attribute_subjects subject', 'CROSS JOIN attribute_subjects subject');
      const scoreLookup = original.replace('JOIN attribute_score_states state', 'CROSS JOIN attribute_score_states state');
      // Fixing either scan alone must still fail: a non-unique indexed SEARCH can also grow.
      for (const sql of [subjectLookup, scoreLookup]) {
        writeFileSync(join(directory, name), sql);
        await expect(checkMigrationRowBudget([name], { directory })).rejects.toThrow(/reads grow/u);
      }
      writeFileSync(join(directory, name), subjectLookup.replace('JOIN attribute_score_states state', 'CROSS JOIN attribute_score_states state'));
      const [bounded] = await checkMigrationRowBudget([name], { directory });
      expect(bounded.growth).toMatchObject({ subjects: 2000, scores: expect.any(Number), reads: bounded.reads, writes: bounded.writes });
      expect(bounded.growth!.scores).toBeGreaterThan(4000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

  test('0135 remains bounded with all nine production subjects present', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'remaining-rating-cost-'));
    try {
      cpSync('migrations', directory, { recursive: true });
      // Historical imports use a different Bus identity. Include the site's real identity
      // before measuring, so both samples exercise all 18 approved ratings.
      writeFileSync(join(directory, '0134_test_production_bus.sql'), readFileSync('tests/fixtures/attribute-production-bus.sql', 'utf8'));
      const [sample] = await checkMigrationRowBudget(['0135_seed_remaining_risk_and_luck_ratings.sql'], { directory });
      expect(sample.growth).toMatchObject({ subjects: 2000, reads: sample.reads, writes: sample.writes });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
