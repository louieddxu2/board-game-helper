import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import {
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
  test('response row budgets stay below the product limit', () => {
    expect(ATTRIBUTE_RESPONSE_MAX_READ_ROWS).toBeLessThan(100);
    expect(ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS).toBeLessThan(100);
    expect(ATTRIBUTE_RESPONSE_MAX_READ_ROWS + ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS).toBeLessThan(100);
  });

  test.each([undefined, 'high', 'low'] as const)('a %s response saves canonical answers with the same bounded transaction', async (highPole) => {
    let alreadySaved = false;
    const statements: DatabaseStatement[] = [];
    const sqlCalls: string[] = [];
    const db = {
      statement: vi.fn().mockImplementation((sql: string) => {
        sqlCalls.push(sql);
        if (sql.includes('SELECT response_id FROM attribute_vote_responses')) {
          const prepared = statement({ first: vi.fn().mockResolvedValue(alreadySaved ? { response_id: 'response-budget-1' } : null) });
          statements.push(prepared);
          return prepared;
        }
        if (sql.includes('SELECT a.id AS attribute_id')) {
          const prepared = statement({ first: vi.fn().mockResolvedValue({
            attribute_id: 'attribute-luck', attribute_name: '運氣',
            scale_type: 'bipolar',
            endpoints_json: JSON.stringify({ low: { label: '得分取勝', question: '得分？' }, high: { label: '條件取勝', question: '條件？' } }),
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

    const result = await saveAttributeResponse(db, {
      subjectAId: 'subject-a', subjectBId: 'subject-b', attributeId: 'attribute-luck',
      responseId: 'response-budget-1', sessionId: 'session-budget-1', actorId: null,
      highPole,
      comparison: highPole === 'low' ? 'B_HIGHER' : 'A_HIGHER',
      ratingA: highPole === 'low' ? 2 : 8, ratingB: 5, timestamp: 123,
    });

    const batchCalls = (db.batch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0][0]).toHaveLength(3);
    expect(batchCalls[1][0]).toHaveLength(4);
    expect(sqlCalls.filter((sql) => sql.includes('SELECT a.id AS attribute_id'))).toHaveLength(1);
    expect(sqlCalls.some((sql) => sql.includes('LEFT JOIN attribute_score_states ssa'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('FROM attribute_score_states\n'))).toBe(false);
    expect(result.updatedValues.find((value) => value.subjectId === 'subject-a')?.directAverage).toBe(8);
    expect(result.activities.find((activity) => activity.kind === 'comparison')).toEqual(expect.objectContaining({
      attributePoles: { low: '得分取勝', high: '條件取勝' }, result: 'A_HIGHER',
    }));
    const responseStatement = statements[sqlCalls.findIndex((sql) => sql.includes('INSERT INTO attribute_vote_responses'))];
    expect(responseStatement.bind).toHaveBeenCalledWith(
      'response-budget-1', 'attribute-luck', 'subject-a', 'subject-b', 8, 5, 'A_HIGHER',
      expect.any(String), null, 'session-budget-1', 123, 123, highPole ?? 'high',
    );
    alreadySaved = true;
    expect(await saveAttributeResponse(db, {
      subjectAId: 'subject-a', subjectBId: 'subject-b', attributeId: 'attribute-luck',
      responseId: 'response-budget-1', sessionId: 'session-budget-1', actorId: null,
      highPole, ratingA: highPole === 'low' ? 2 : 8, timestamp: 124,
    })).toEqual({ updatedValues: [], activities: [] });
    expect(sqlCalls.filter((sql) => sql.includes('INSERT INTO attribute_vote_responses'))).toHaveLength(1);
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

});
