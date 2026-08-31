import { describe, expect, test } from 'vitest';
import {
  ATTRIBUTE_DIRECT_RATING_HISTORY_LIMIT,
  attributeDirectRatingKey,
  attributeDirectRatingKeysFromResponse,
  attributeDirectRatingRecordsFromResponse,
  newestAttributeDirectRatingRecords,
} from './attributeDirectRatings';

describe('local direct attribute rating history', () => {
  test('records explicit zero ratings but ignores comparison-only subjects', () => {
    const response = {
      subjectAId: 'subject-a',
      subjectBId: 'subject-b',
      attributeId: 'attribute-luck',
      responseId: 'response-1',
      ratingA: 0,
      ratingB: null,
    };

    expect(attributeDirectRatingKeysFromResponse(response)).toEqual([
      attributeDirectRatingKey('subject-a', 'attribute-luck'),
    ]);
    expect(attributeDirectRatingRecordsFromResponse('session-1', response, 10)).toMatchObject([{
      subjectId: 'subject-a',
      attributeId: 'attribute-luck',
      value: 0,
      ratedAt: 10,
    }]);
  });

  test('retains only the newest one thousand unique rating records', () => {
    const records = Array.from({ length: ATTRIBUTE_DIRECT_RATING_HISTORY_LIMIT + 2 }, (_, index) =>
      attributeDirectRatingRecordsFromResponse('session-1', {
        subjectAId: `subject-${index}`,
        subjectBId: 'unused',
        attributeId: 'attribute-luck',
        responseId: `response-${index}`,
        ratingA: 5,
      }, index)[0]);

    const retained = newestAttributeDirectRatingRecords(records);

    expect(retained).toHaveLength(ATTRIBUTE_DIRECT_RATING_HISTORY_LIMIT);
    expect(retained.some((record) => record.subjectId === 'subject-0')).toBe(false);
    expect(retained.some((record) => record.subjectId === 'subject-1')).toBe(false);
    expect(retained[0].subjectId).toBe(`subject-${ATTRIBUTE_DIRECT_RATING_HISTORY_LIMIT + 1}`);
  });
});
