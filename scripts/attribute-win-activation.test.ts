// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';

const setup = () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
    try { sqlite.exec(readFileSync(`migrations/${name}`, 'utf8')); }
    catch (error) { sqlite.close(); throw new Error(`Migration ${name}: ${String(error)}`); }
  }
  sqlite.exec('PRAGMA foreign_keys = ON');
  interface SqliteStatement {
    bind(...values: SQLInputValue[]): SqliteStatement;
    all(): Promise<{ results: unknown[]; meta: { changes: number } }>;
  }
  const prepare = (sql: string, args: SQLInputValue[] = []): SqliteStatement => ({
    bind: (...values: SQLInputValue[]) => prepare(sql, values),
    all: async () => {
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) return { results: statement.all(...args), meta: { changes: 0 } };
      const result = statement.run(...args);
      return { results: [], meta: { changes: Number(result.changes) } };
    },
  });
  return { sqlite, prepare };
};

test('activates the bipolar win method and publishes converted catalog data', () => {
  const { sqlite } = setup();
  try {
    expect(sqlite.prepare("SELECT id, is_active, scale_type, sort_order FROM attributes WHERE id='attribute_win_method'").get()).toMatchObject({
      id: 'attribute_win_method', is_active: 1, scale_type: 'bipolar', sort_order: 12,
    });
    expect(sqlite.prepare("SELECT is_active FROM attributes WHERE id IN ('attribute_score_race','attribute_end_condition') ORDER BY id").all()).toEqual([
      { is_active: 0 }, { is_active: 0 },
    ]);

    const corrected = sqlite.prepare("SELECT score, direct_count, evidence_count FROM attribute_score_states WHERE subject_id='attribute_subject_game:game_attribute_import_the_mind' AND attribute_id='attribute_win_method'").get();
    expect(corrected).toMatchObject({ score: 9, direct_count: 1, evidence_count: 1 });
    expect(sqlite.prepare("SELECT count(*) AS n FROM attribute_score_states WHERE attribute_id IN ('attribute_score_race','attribute_end_condition')").get()).toMatchObject({ n: 0 });
    expect(sqlite.prepare('SELECT count(*) AS n FROM attribute_activity_feed').get()).toMatchObject({ n: 0 });

    const candidate = sqlite.prepare("SELECT values_json FROM attribute_import_candidates WHERE id='attribute_candidate:4'").get() as { values_json: string };
    const candidateValues = JSON.parse(candidate.values_json) as unknown[];
    expect(candidateValues).toHaveLength(25);
    expect(candidateValues[12]).toBe(1);

    const snapshot = sqlite.prepare('SELECT active_generation, attributes_json, chunk_count FROM attribute_catalog_snapshot_state WHERE id=1').get() as { active_generation: number; attributes_json: string; chunk_count: number };
    expect(snapshot.active_generation).toBe(88);
    const attributes = JSON.parse(snapshot.attributes_json) as Array<{ id: string; scaleType?: string; endpoints?: { low?: { label?: string }; high?: { label?: string } } }>;
    const merged = attributes.find((attribute) => attribute.id === 'attribute_win_method');
    expect(merged).toMatchObject({ scaleType: 'bipolar', endpoints: { low: { label: '得分取勝' }, high: { label: '條件取勝' } } });
    expect(attributes.some((attribute) => attribute.id === 'attribute_score_race')).toBe(false);
    expect(snapshot.chunk_count).toBeGreaterThan(0);
  } finally { sqlite.close(); }
});
