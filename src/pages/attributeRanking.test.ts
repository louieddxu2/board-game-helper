import { describe, expect, it, vi } from 'vitest';
import { localDb } from '../lib/localDb';
import type { AttributeCatalogPayload, AttributeQuestion } from '../shared/types';
import { canPlaceRankedSubject, loadRankingRound, rankedAttributeResponses, RANKING_CANDIDATES_PER_PAGE } from './attributeRanking';
import { rankingComparisons } from '../shared/attributeRankingBallot';

const subject = (id: string) => ({ id, slug: id, displayName: id, kind: 'game' as const });
const question: AttributeQuestion = {
  attribute: { id: 'test-attribute', key: 'test', name: '屬性', minValue: 0, maxValue: 10, sortOrder: 0 },
  subjectA: subject('a'), subjectB: subject('b'), highPole: 'low',
};

it('uses the displayed attribute direction and keeps the drawn candidates separate from references', async () => {
  const context = vi.spyOn(localDb, 'getAttributeQuestionContext').mockResolvedValue({ deferred: [], questionNumber: 0 });
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    const candidates = ['a', 'b', ...Array.from({ length: RANKING_CANDIDATES_PER_PAGE - 2 }, (_, index) => `game-${index}`)];
    const catalog: AttributeCatalogPayload = {
      generation: 1, generatedAt: 1, throughVersion: 1, attributes: [question.attribute],
      subjects: [...candidates, 'high', 'low'].map(subject), candidates: [], activities: [],
      values: ([['a', 10], ['game-8', 10], ['high', 9], ['low', 1]] as const).map(([subjectId, score]) => ({
        subjectId, attributeId: question.attribute.id, score,
        directCount: 1, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 1, modelVersion: 'test',
      })),
    };
    const round = await loadRankingRound(catalog, question);
    expect(round.candidates.map(({ id }) => id)).toEqual(candidates);
    expect(round.references.map(({ subject, score }) => [subject.id, score])).toEqual([['low', 9], ['high', 1]]);
  } finally {
    context.mockRestore();
    random.mockRestore();
  }
});

describe('rankedAttributeResponses', () => {
  it.each([
    ['12', ['12']],
    ['12345', ['23', '34', '12', '45']],
    ['123456', ['34', '23', '45', '12', '56']],
  ])('stores one original ballot that expands into center-out adjacent comparisons (%s)', (order, expected) => {
    const responses = rankedAttributeResponses(question, [...order], 'test-session', new Set(), 'test-batch', 100);
    expect(responses).toHaveLength(1);
    expect(rankingComparisons(responses[0].ranking!).map(({ subjectAId, subjectBId }) => subjectAId + subjectBId)).toEqual(expected);
    expect(responses.every((response) => response.attributeId === 'test-attribute' && response.highPole === 'low'
      && response.comparison === undefined && response.createdAt === 100)).toBe(true);
    expect(responses[0].ranking?.orderedSubjectIds).toEqual([...order]);
    expect(responses[0].id).toBe('test-batch:rank:ballot');
  });

  it('compares player entries from the center out with references removed first', () => {
    const references = new Set(['a', 'b', 'c', 'd']);
    const responses = rankedAttributeResponses(question, [...'a12b3c45d6'], 'test-session', references);
    expect(responses[0].ranking).toEqual({ version: 1, orderedSubjectIds: [...'a12b3c45d6'], referenceSubjectIds: [...'abcd'] });
    expect(rankingComparisons(responses[0].ranking!).map(({ subjectAId, subjectBId }) => subjectAId + subjectBId)).toEqual(['34', '23', '45', '12', '56']);
    expect(rankedAttributeResponses(question, [...'a1bcd'], 'test-session', references)).toEqual([]);
  });
});

describe('canPlaceRankedSubject', () => {
  it('lets references cross player entries in either direction only', () => {
    const order = ['high', 'game', 'middle', 'other', 'low'];
    const references = new Set(['high', 'middle', 'low']);
    expect(canPlaceRankedSubject(order, references, 'middle', 1)).toBe(true);
    expect(canPlaceRankedSubject(order, references, 'middle', 4)).toBe(true);
    expect(canPlaceRankedSubject(order, references, 'middle', 0)).toBe(false);
    expect(canPlaceRankedSubject(order, references, 'middle', 5)).toBe(false);
    expect(canPlaceRankedSubject(order, references, 'game', 5)).toBe(true);
  });
});
