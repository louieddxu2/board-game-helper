import { describe, expect, test } from 'vitest';
import { parseAttributeActivityFeedEntry } from './data/attributes';

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
});
