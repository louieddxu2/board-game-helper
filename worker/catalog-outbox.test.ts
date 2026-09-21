import { describe, expect, test, vi } from 'vitest';
import { flushCatalogOutbox } from './data/catalogOutbox';
import type { Database, DatabaseStatement } from './data/database';

interface CapturedStatement extends DatabaseStatement {
  sql: string;
  values: unknown[];
}

const prepared = (sql: string, handlers: Partial<DatabaseStatement> = {}): CapturedStatement => {
  const statement: CapturedStatement = {
    sql,
    values: [],
    bind(...values: unknown[]) { this.values = values; return this; },
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    ...handlers,
  };
  return statement;
};

describe('catalog outbox publisher', () => {
  test('publishes one complete subject bundle without querying a catalog view or snapshot', async () => {
    const statements: CapturedStatement[] = [];
    const db = {
      statement: vi.fn().mockImplementation((sql: string) => {
        let statement: CapturedStatement;
        if (sql.includes('FROM catalog_change_outbox')) {
          statement = prepared(sql, { all: vi.fn().mockResolvedValue({ results: [{
            catalog: 'attribute-subject', entity_key: 'subject-a', revision: 3,
          }] }) });
        } else if (sql.includes('FROM attribute_subjects s')) {
          statement = prepared(sql, { all: vi.fn().mockResolvedValue({ results: [{
            id: 'subject-a', slug: 'game-a', kind: 'game', display_name: '遊戲甲',
            game_id: 'game-a', game_slug: 'game-a', secondary_name: null, bgg_ids_json: '[123]',
          }] }) });
        } else if (sql.includes('FROM attribute_subject_components')) {
          statement = prepared(sql, { all: vi.fn().mockResolvedValue({ results: [] }) });
        } else if (sql.includes('FROM attribute_score_states state')) {
          statement = prepared(sql, { all: vi.fn().mockResolvedValue({ results: [{
            subject_id: 'subject-a', attribute_id: 'attribute-luck', score: 7.5,
            rating_deviation: 2, direct_sum: 15, direct_count: 2, comparison_count: 1,
            decisive_comparison_count: 1, evidence_count: 3,
          }] }) });
        } else if (sql.includes('UPDATE attribute_catalog_clock')) {
          statement = prepared(sql, { first: vi.fn().mockResolvedValue({ current_version: 17 }) });
        } else {
          statement = prepared(sql);
        }
        statements.push(statement);
        return statement;
      }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    await expect(flushCatalogOutbox(db, 123)).resolves.toEqual({
      processed: { 'attribute-subject': 1 },
    });

    expect(statements.some((statement) => /attribute_subject_catalog_source|attribute_catalog_snapshot|attribute_catalog_entries\s+WHERE/i.test(statement.sql))).toBe(false);
    const entryBatch = (db.batch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as CapturedStatement[];
    expect(entryBatch).toHaveLength(1);
    expect(entryBatch[0].values).toEqual([
      'subject:subject-a', 17, expect.stringContaining('"kind":"subjectBundle"'), 0, 123,
    ]);
    expect(JSON.parse(String(entryBatch[0].values[2]))).toMatchObject({
      kind: 'subjectBundle',
      subject: { id: 'subject-a', bggIds: [123] },
      values: [{ subjectId: 'subject-a', attributeId: 'attribute-luck', score: 7.5 }],
    });
  });

  test('splits a full outbox page into D1-safe revision-aware deletes', async () => {
    const statements: CapturedStatement[] = [];
    const rows = Array.from({ length: 100 }, (_, index) => ({
      catalog: 'game' as const,
      entity_key: `game-${index}`,
      revision: index + 1,
    }));
    const db = {
      statement: vi.fn().mockImplementation((sql: string) => {
        let statement: CapturedStatement;
        if (sql.includes('SELECT catalog, entity_key, revision')) {
          statement = prepared(sql, { all: vi.fn().mockResolvedValue({ results: rows }) });
        } else if (sql.includes('FROM game_catalog_source')) {
          statement = prepared(sql, { all: vi.fn().mockResolvedValue({ results: [] }) });
        } else if (sql.includes('UPDATE game_catalog_clock')) {
          statement = prepared(sql, { first: vi.fn().mockResolvedValue({ current_version: 100 }) });
        } else {
          statement = prepared(sql);
        }
        statements.push(statement);
        return statement;
      }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    await expect(flushCatalogOutbox(db, 123)).resolves.toEqual({
      processed: { game: 100 },
    });

    const deletes = statements.filter((statement) => statement.sql.includes('DELETE FROM catalog_change_outbox'));
    expect(deletes).toHaveLength(3);
    expect(deletes.map((statement) => statement.values)).toEqual([
      ['game', ...rows.slice(0, 49).flatMap((row) => [row.entity_key, row.revision])],
      ['game', ...rows.slice(49, 98).flatMap((row) => [row.entity_key, row.revision])],
      ['game', ...rows.slice(98).flatMap((row) => [row.entity_key, row.revision])],
    ]);
    expect(deletes.every((statement) => statement.values.length <= 99)).toBe(true);
  });
});
