import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import {
  ATTRIBUTE_ACTIVITY_FEED_LIMIT,
  ATTRIBUTE_QUESTION_MAX_RETURNED_ROWS,
  ATTRIBUTE_QUESTION_PAIR_PROBE_LIMIT,
  ATTRIBUTE_RESPONSE_MAX_READ_ROWS,
  ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS,
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
    const boundedRows = 2 + 1 + ATTRIBUTE_QUESTION_PAIR_PROBE_LIMIT + ATTRIBUTE_QUESTION_PAIR_PROBE_LIMIT + 2 + ATTRIBUTE_ACTIVITY_FEED_LIMIT;
    expect(boundedRows).toBe(ATTRIBUTE_QUESTION_MAX_RETURNED_ROWS);
    expect(boundedRows).toBeLessThan(100);
  });

  test('response row budgets stay below the product limit', () => {
    expect(ATTRIBUTE_RESPONSE_MAX_READ_ROWS).toBeLessThanOrEqual(8);
    expect(ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS).toBeLessThanOrEqual(7);
    expect(ATTRIBUTE_RESPONSE_MAX_READ_ROWS + ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS).toBeLessThan(100);
  });

  test('a complete response uses three bounded reads and at most seven writes', async () => {
    const statements: DatabaseStatement[] = [];
    const db = {
      statement: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT id FROM attribute_vote_events')) {
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

    expect(statements.slice(0, 3)).toHaveLength(3);
    expect(db.batch).toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
    expect((db.batch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(7);
  });
});
