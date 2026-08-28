import { describe, expect, test, vi } from 'vitest';
import { parseAttributeActivityFeedEntry, queryRecentActivities } from './data/attributes';

const subjectA = { id: 'subject-a', displayName: '遊戲甲' };
const subjectB = { id: 'subject-b', displayName: '遊戲乙' };

describe('attribute activity feed', () => {
  test('collapses one response into its comparison and attaches direct ratings by subject', () => {
    const activities = parseAttributeActivityFeedEntry(JSON.stringify([
      { id: 'rating-b', kind: 'rating', actorName: '玩家', attributeId: 'luck', attributeName: '運氣成分', subject: subjectB, value: 3, createdAt: 1 },
      { id: 'rating-a', kind: 'rating', actorName: '玩家', attributeId: 'luck', attributeName: '運氣成分', subject: subjectA, value: 8, createdAt: 1 },
      { id: 'comparison', kind: 'comparison', actorName: '玩家', attributeId: 'luck', attributeName: '運氣成分', subjectA, subjectB, result: 'A_HIGHER', createdAt: 1 },
    ]));

    expect(activities).toEqual([expect.objectContaining({
      id: 'comparison',
      kind: 'comparison',
      ratingA: 8,
      ratingB: 3,
    })]);
  });

  test('does not expose rating-only legacy entries in the comparison feed', () => {
    expect(parseAttributeActivityFeedEntry(JSON.stringify([
      { id: 'rating-a', kind: 'rating', actorName: '玩家', attributeId: 'luck', attributeName: '運氣成分', subject: subjectA, value: 8, createdAt: 1 },
    ]))).toEqual([]);
  });

  test('reads the stored activity snapshot without rehydrating subject views', async () => {
    const statement = {
      bind: vi.fn(function (this: typeof statement) { return this; }),
      all: vi.fn().mockResolvedValue({ results: [{
        id: 'response-1',
        payload_json: JSON.stringify([
          { id: 'comparison-1', kind: 'comparison', actorName: '玩家', attributeId: 'luck', attributeName: '運氣成分', subjectA, subjectB, result: 'A_HIGHER', createdAt: 1 },
        ]),
      }] }),
    };
    const db = { statement: vi.fn().mockReturnValue(statement) };

    await expect(queryRecentActivities(db as never)).resolves.toEqual([expect.objectContaining({ id: 'comparison-1' })]);
    expect(db.statement).toHaveBeenCalledOnce();
    expect(db.statement.mock.calls[0][0]).not.toContain('attribute_subject_display_names');
    expect(db.statement.mock.calls[0][0]).not.toContain('attribute_votable_subjects');
  });
});
