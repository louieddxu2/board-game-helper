// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { ATTRIBUTE_RESPONSE_MAX_READ_ROWS, ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS, saveAttributeResponse } from './data/attributes';
import { createHarness, scoreRows } from '../scripts/attributeReplayTestHarness';

describe('attribute hot-path budgets and receipts', () => {
  test('response row budgets stay below the product limit', () => {
    expect(ATTRIBUTE_RESPONSE_MAX_READ_ROWS).toBeLessThan(100);
    expect(ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS).toBeLessThan(100);
    expect(ATTRIBUTE_RESPONSE_MAX_READ_ROWS + ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS).toBeLessThan(100);
  });

  test.each([undefined, 'high', 'low'] as const)('a %s response stores canonical answers once', async (highPole) => {
    const h = createHarness();
    try {
      h.sqlite.exec('DELETE FROM attribute_score_states');
      const ids = h.sqlite.prepare(`SELECT subject_id FROM attribute_votable_subjects ORDER BY subject_id LIMIT 2`)
        .all().map((row: { subject_id: unknown }) => String(row.subject_id));
      const input = { subjectAId: ids[0], subjectBId: ids[1], attributeId: 'attribute_win_method',
        responseId: 'budget-response', sessionId: 'budget-session', actorId: null, highPole,
        comparison: highPole === 'low' ? 'B_HIGHER' as const : 'A_HIGHER' as const,
        ratingA: highPole === 'low' ? 2 : 8, ratingB: 5, timestamp: Date.now() };
      const result = await saveAttributeResponse(h.gateway, input);
      expect(result.scoreStatus).toBe('applied');
      expect(result.updatedValues.find((value) => value.subjectId === ids[0])?.directAverage).toBe(8);
      expect(result.activities.find((activity) => activity.kind === 'comparison')).toMatchObject({
        attributePoles: { low: '得分取勝', high: '條件取勝' }, result: 'A_HIGHER',
      });
      expect(h.sqlite.prepare(`SELECT rating_a, rating_b, comparison, online_weight FROM attribute_vote_responses
        WHERE response_id = ?`).get(input.responseId)).toEqual({ rating_a: 8, rating_b: 5, comparison: 'A_HIGHER', online_weight: 1 });
      const before = scoreRows(h);
      await expect(saveAttributeResponse(h.gateway, input)).resolves.toMatchObject({ activities: [], updatedValues: [], scoreStatus: 'applied' });
      expect(scoreRows(h)).toEqual(before);
      expect(h.executedSql.some((sql) => sql.includes('LEFT JOIN attribute_score_states ssa'))).toBe(false);
    } finally { h.sqlite.close(); }
  });
});
