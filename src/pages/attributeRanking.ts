import { availableAttributeSubjectIds, matchCollectionSubjects, randomSample } from '../lib/attributeCollection';
import { createAttributeResponseId } from '../lib/attributeSession';
import { localDb, type PendingAttributeResponse } from '../lib/localDb';
import type { AttributeCatalogPayload, AttributeQuestion } from '../shared/types';

export const RANKING_RESPONSE_ID_MARKER = ':rank:';

export const loadRankingCandidates = async (catalog: AttributeCatalogPayload, question: AttributeQuestion, collectionIds?: number[]) => {
  const scope = collectionIds ? matchCollectionSubjects(catalog, collectionIds).subjectIds : undefined;
  const { deferred, questionNumber } = await localDb.getAttributeQuestionContext().catch(() => ({ deferred: [], questionNumber: 0 }));
  const available = new Set(availableAttributeSubjectIds(catalog, scope, deferred, questionNumber));
  const preferred = new Set([question.subjectA.id, question.subjectB.id]);
  const candidates = catalog.subjects.filter((subject) => available.has(subject.id));
  const rest = candidates.filter((subject) => !preferred.has(subject.id));
  const gameIds = new Set<string>();
  return [...candidates.filter((subject) => preferred.has(subject.id)), ...randomSample(rest, rest.length, Math.random)]
    .filter(({ gameId }) => {
      // The response endpoint forbids comparing two subjects linked to the same game.
      if (!gameId) return true;
      if (gameIds.has(gameId)) return false;
      gameIds.add(gameId);
      return true;
    });
};

export const rankedAttributeResponses = (
  question: AttributeQuestion,
  order: readonly string[],
  sessionId: string,
  batchId = createAttributeResponseId(),
  createdAt = Date.now(),
): PendingAttributeResponse[] => {
  const middle = order.length - 2;
  const edges = Array.from({ length: order.length - 1 }, (_, index) => index)
    .sort((a, b) => Math.abs(2 * a - middle) - Math.abs(2 * b - middle) || a - b);
  return edges.map((edge, index) => {
    const responseId = `${batchId}${RANKING_RESPONSE_ID_MARKER}${String(index).padStart(6, '0')}`;
    return {
      id: responseId,
      responseId,
      subjectAId: order[edge],
      subjectBId: order[edge + 1],
      attributeId: question.attribute.id,
      highPole: question.highPole,
      comparison: 'A_HIGHER',
      sessionId,
      createdAt,
    };
  });
};
