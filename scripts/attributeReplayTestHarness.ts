import { type SQLInputValue } from 'node:sqlite';
// @ts-expect-error The migration guard is an intentional JavaScript test helper.
import { buildMigratedSchema } from './check-d1-trigger-fanout.mjs';
import { createDatabase } from '../worker/data/database';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';

interface SqliteStatement {
  bind(...values: SQLInputValue[]): SqliteStatement;
  all(): Promise<{ results: unknown[]; meta: { changes: number } }>;
  run(): Promise<{ results: unknown[]; meta: { changes: number } }>;
}

export const createHarness = () => {
  const sqlite = buildMigratedSchema();
  sqlite.exec('PRAGMA foreign_keys = ON');
  // A migration fixture may contain delivery work from its seed history. The
  // weekly job starts after the real outbox worker has drained that work.
  sqlite.exec('DELETE FROM catalog_change_outbox');
  const executedSql: string[] = [];
  const prepare = (sql: string, args: SQLInputValue[] = []): SqliteStatement => ({
    bind: (...values: SQLInputValue[]) => prepare(sql, values),
    run: () => prepare(sql, args).all(),
    all: async () => {
      executedSql.push(sql);
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) return { results: statement.all(...args), meta: { changes: 0 } };
      const result = statement.run(...args);
      return { results: [], meta: { changes: Number(result.changes) } };
    },
  });
  const env = { DB: {
    prepare,
    batch: async (statements: SqliteStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } } as unknown as Parameters<typeof createDatabase>[0];
  const gateway = createDatabase(env);
  return { sqlite, gateway, env, executedSql };
};

type Harness = ReturnType<typeof createHarness>;
type ReplayStatus = { required_revision: number; replayed_revision: number; replayed_model_version: string | null };

export const status = (harness: Harness) => harness.sqlite.prepare(`
  SELECT required_revision, replayed_revision, replayed_model_version
  FROM attribute_replay_status WHERE id = 1
`).get() as ReplayStatus;

export const subjects = (harness: Harness) => harness.sqlite.prepare(`
  SELECT id, game_id FROM attribute_subjects
  WHERE game_id IS NOT NULL ORDER BY id LIMIT 2
`).all() as Array<{ id: string; game_id: string }>;

export const scoreRows = (harness: Harness) => harness.sqlite.prepare(`
  SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
    comparison_count, decisive_comparison_count, evidence_count, model_version
  FROM attribute_score_states ORDER BY subject_id, attribute_id
`).all().map((row: Record<string, unknown>) => {
  const value = row;
  return [
    value.subject_id, value.attribute_id, value.score, value.rating_deviation,
    value.direct_sum, value.direct_count, value.comparison_count,
    value.decisive_comparison_count, value.evidence_count, value.model_version,
  ];
});

export const establishBaseline = async (beforeReplay?: (harness: Harness) => void) => {
  const harness = createHarness();
  beforeReplay?.(harness);
  const timestamp = Date.now() + 100_000;
  await runCompleteAttributeReplay(harness.gateway, timestamp);
  harness.executedSql.length = 0;
  return { harness, timestamp };
};

export const close = (harness: Harness) => harness.sqlite.close();
