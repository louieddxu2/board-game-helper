import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import {
  ATTRIBUTE_ACTIVITY_FEED_LIMIT,
  ATTRIBUTE_EXTREME_EXAMPLE_LIMIT,
  ATTRIBUTE_QUESTION_OPPONENT_CANDIDATE_LIMIT,
  ATTRIBUTE_QUESTION_PAIR_STAT_LIMIT,
  ATTRIBUTE_QUESTION_MAX_ROWS_READ,
  ATTRIBUTE_QUESTION_MAX_RETURNED_ROWS,
  ATTRIBUTE_RESPONSE_MAX_READ_ROWS,
  ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS,
  prepareAttributeMergeRebuildJob,
  saveAttributeResponse,
} from './data/attributes';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

describe('attribute hot-path budgets', () => {
  test('question result stays bounded without a full matrix or pair scan', () => {
    const boundedRows = 1 + 1
      + ATTRIBUTE_QUESTION_OPPONENT_CANDIDATE_LIMIT
      + ATTRIBUTE_QUESTION_PAIR_STAT_LIMIT
      + 2
      + (ATTRIBUTE_EXTREME_EXAMPLE_LIMIT * 2)
      + ATTRIBUTE_ACTIVITY_FEED_LIMIT;
    expect(boundedRows).toBe(ATTRIBUTE_QUESTION_MAX_RETURNED_ROWS);
    expect(ATTRIBUTE_QUESTION_MAX_ROWS_READ).toBeGreaterThanOrEqual(boundedRows);
    expect(ATTRIBUTE_QUESTION_MAX_ROWS_READ).toBeLessThan(100);
  });

  test('response row budgets stay below the product limit', () => {
    expect(ATTRIBUTE_RESPONSE_MAX_READ_ROWS).toBeLessThan(100);
    expect(ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS).toBeLessThan(100);
    expect(ATTRIBUTE_RESPONSE_MAX_READ_ROWS + ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS).toBeLessThan(100);
  });

  test('a complete response uses bounded reads and three core writes', async () => {
    const statements: DatabaseStatement[] = [];
    const db = {
      statement: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT response_id FROM attribute_vote_responses')) {
          const prepared = statement({ first: vi.fn().mockResolvedValue(null) });
          statements.push(prepared);
          return prepared;
        }
        if (sql.includes('SELECT a.id AS attribute_id')) {
          const prepared = statement({ first: vi.fn().mockResolvedValue({
            attribute_id: 'attribute-luck', attribute_name: '運氣',
            subject_a_id: 'subject-a', subject_a_name: '遊戲甲', subject_a_slug: 'game-a', subject_a_game_slug: 'game-a',
            subject_b_id: 'subject-b', subject_b_name: '遊戲乙', subject_b_slug: 'game-b', subject_b_game_slug: 'game-b',
            actor_name: '匿名玩家',
          }) });
          statements.push(prepared);
          return prepared;
        }
        if (sql.includes('SELECT subject_id, attribute_id')) {
          const prepared = statement({ all: vi.fn().mockResolvedValue({ results: [
            { subject_id: 'subject-a', attribute_id: 'attribute-luck', score: 5, rating_deviation: 3, direct_sum: 0, direct_count: 0, comparison_count: 0, decisive_comparison_count: 0, evidence_count: 0 },
            { subject_id: 'subject-b', attribute_id: 'attribute-luck', score: 5, rating_deviation: 3, direct_sum: 0, direct_count: 0, comparison_count: 0, decisive_comparison_count: 0, evidence_count: 0 },
          ] } ) });
          statements.push(prepared);
          return prepared;
        }
        const prepared = statement();
        statements.push(prepared);
        return prepared;
      }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    await saveAttributeResponse(db, {
      subjectAId: 'subject-a', subjectBId: 'subject-b', attributeId: 'attribute-luck',
      responseId: 'response-budget-1', sessionId: 'session-budget-1', actorId: null,
      comparison: 'A_HIGHER', ratingA: 8, ratingB: 5, timestamp: 123,
    });

    const batchCalls = (db.batch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0][0]).toHaveLength(3);
    expect(batchCalls[1][0]).toHaveLength(3);
  });

  test('rejects a concurrent response before reading or rewriting score states', async () => {
    const db = {
      statement: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT response_id FROM attribute_vote_responses')) return statement({ first: vi.fn().mockResolvedValue(null) });
        return statement({ run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }) });
      }),
      batch: vi.fn().mockResolvedValue([
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
        { meta: { changes: 0 } },
      ]),
    } as unknown as Database;

    await expect(saveAttributeResponse(db, {
      subjectAId: 'subject-a', subjectBId: 'subject-b', attributeId: 'attribute-luck',
      responseId: 'response-busy-1', sessionId: 'session-busy-1', actorId: null,
      comparison: 'SIMILAR', timestamp: 123,
    })).rejects.toThrow('attribute_response_busy');
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.statement).not.toHaveBeenCalledWith(expect.stringContaining('FROM attribute_score_states'));
  });

  test('merge preparation creates a rebuild job without loading historical votes', async () => {
    const sqlCalls: string[] = [];
    const db = {
      statement: vi.fn().mockImplementation((sql: string) => {
        sqlCalls.push(sql);
        if (sql.includes('FROM attribute_subjects')) {
          return statement({ all: vi.fn().mockResolvedValue({ results: [
            { game_id: 'game-source', id: 'subject-source' },
            { game_id: 'game-target', id: 'subject-target' },
          ] }) });
        }
        if (sql.includes('FROM attribute_merge_rebuild_jobs')) {
          return statement({ first: vi.fn().mockResolvedValue(null) });
        }
        return statement();
      }),
    } as unknown as Database;

    const plan = await prepareAttributeMergeRebuildJob(db, 'game-source', 'game-target', 123);

    expect(plan.statement).not.toBeNull();
    expect(sqlCalls.some((sql) => sql.includes('attribute_vote_events'))).toBe(false);
    expect(sqlCalls.some((sql) => sql.includes('attribute_vote_responses'))).toBe(false);
  });
});
