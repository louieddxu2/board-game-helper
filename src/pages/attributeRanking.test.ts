import { describe, expect, it } from 'vitest';
import type { AttributeQuestion } from '../shared/types';
import { rankedAttributeResponses } from './attributeRanking';

const subject = (id: string) => ({ id, slug: id, displayName: id, kind: 'game' as const });
const question: AttributeQuestion = {
  attribute: { id: 'test-attribute', key: 'test', name: '屬性', minValue: 0, maxValue: 10, sortOrder: 0 },
  subjectA: subject('a'), subjectB: subject('b'), highPole: 'low',
};

describe('rankedAttributeResponses', () => {
  it.each([
    ['12', ['12']],
    ['12345', ['23', '34', '12', '45']],
    ['123456', ['34', '23', '45', '12', '56']],
  ])('records only adjacent comparisons, from the center out (%s)', (order, expected) => {
    const responses = rankedAttributeResponses(question, [...order], 'test-session', 'test-batch', 100);
    expect(responses.map(({ subjectAId, subjectBId }) => subjectAId + subjectBId)).toEqual(expected);
    expect(responses.every((response) => response.attributeId === 'test-attribute' && response.highPole === 'low'
      && response.comparison === 'A_HIGHER' && response.createdAt === 100)).toBe(true);
    expect(responses.map((response) => response.id)).toEqual(expected.map((_, index) => `test-batch:rank:${String(index).padStart(6, '0')}`));
  });
});
