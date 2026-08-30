import { describe, expect, test } from 'vitest';
import { rankAttributeSimilarity } from './attributeSimilarity';
import type { AttributeMatrixValue } from '../shared/types';

const value = (subjectId: string, attributeId: string, score: number, evidenceCount: number, ratingDeviation = 1): AttributeMatrixValue => ({
  subjectId,
  attributeId,
  score,
  ratingDeviation,
  directCount: evidenceCount,
  comparisonCount: 0,
  decisiveComparisonCount: 0,
  evidenceCount,
  modelVersion: 'glicko-rd-v1',
});

describe('rankAttributeSimilarity', () => {
  test('ignores untouched default scores and ranks real overlapping evidence', () => {
    const matches = rankAttributeSimilarity(
      [value('anchor', 'a', 5, 0, 3), value('anchor', 'b', 8, 2)],
      [
        { subjectId: 'close', values: [value('close', 'a', 5, 0, 3), value('close', 'b', 7.5, 2)] },
        { subjectId: 'far', values: [value('far', 'a', 5, 0, 3), value('far', 'b', 2, 2)] },
      ],
    );

    expect(matches.map((match) => match.subjectId)).toEqual(['close', 'far']);
    expect(matches[0]?.sharedAttributeCount).toBe(1);
  });

  test('returns no result when the anchor or every candidate only has untouched defaults', () => {
    const untouched = value('anchor', 'a', 5, 0, 3);
    expect(rankAttributeSimilarity([untouched], [{ subjectId: 'other', values: [value('other', 'a', 5, 0, 3)] }])).toEqual([]);
    expect(rankAttributeSimilarity([value('anchor', 'a', 6, 1)], [{ subjectId: 'other', values: [value('other', 'a', 5, 0, 3)] }])).toEqual([]);
  });
});
