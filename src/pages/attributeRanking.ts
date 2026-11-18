import { attributeSubjectBggIds, availableAttributeSubjectIds, chooseScopedExtremeExamples, matchCollectionSubjects, randomSample } from '../lib/attributeCollection';
import { createAttributeResponseId } from '../lib/attributeSession';
import { localDb, type PendingAttributeResponse } from '../lib/localDb';
import { orientAttributeScore } from '../shared/attributeScale';
import type { AttributeCatalogPayload, AttributeQuestion, AttributeSubject } from '../shared/types';
import { rankingPlayerOrder } from '../shared/attributeRankingBallot';

export const RANKING_RESPONSE_ID_MARKER = ':rank:';
export const RANKING_CANDIDATES_PER_PAGE = 18;

export const deferRankingCandidate = async (subject: AttributeSubject) => {
  const questionNumber = await localDb.getAttributeQuestionNumber();
  await localDb.deferAttributeSubject(subject.id, attributeSubjectBggIds(subject), questionNumber, 100);
};

export const loadRankingRound = async (catalog: AttributeCatalogPayload, question: AttributeQuestion, collectionIds?: number[]) => {
  const scope = collectionIds ? matchCollectionSubjects(catalog, collectionIds).subjectIds : undefined;
  const { deferred, questionNumber } = await localDb.getAttributeQuestionContext().catch(() => ({ deferred: [], questionNumber: 0 }));
  const available = new Set(availableAttributeSubjectIds(catalog, scope, deferred, questionNumber));
  const preferred = new Set([question.subjectA.id, question.subjectB.id]);
  const candidates = catalog.subjects.filter((subject) => available.has(subject.id));
  const rest = candidates.filter((subject) => !preferred.has(subject.id));
  const gameIds = new Set<string>();
  const distinct = [...candidates.filter((subject) => preferred.has(subject.id)), ...randomSample(rest, rest.length, Math.random)]
    .filter(({ gameId }) => {
      // The response endpoint forbids comparing two subjects linked to the same game.
      if (!gameId) return true;
      if (gameIds.has(gameId)) return false;
      gameIds.add(gameId);
      return true;
    });
  // Preserve the whole first draw. References come only from games outside it.
  const referenceCatalog = { ...catalog, subjects: distinct.slice(RANKING_CANDIDATES_PER_PAGE) };
  const { lowest, highest } = chooseScopedExtremeExamples(referenceCatalog, question.attribute.id);
  const references = [...lowest, ...highest]
    .map((example) => ({ ...example, score: orientAttributeScore(example.score, question.highPole) }))
    .sort((left, right) => right.score - left.score);
  const referenceIds = new Set(references.map(({ subject }) => subject.id));
  return { candidates: distinct.filter(({ id }) => !referenceIds.has(id)), references };
};

export const canPlaceRankedSubject = (order: readonly string[], referenceIds: ReadonlySet<string>, id: string, index: number) => {
  if (!referenceIds.has(id)) return true;
  const current = order.indexOf(id);
  if (current < 0) return false;
  const crossed = index > current ? order.slice(current + 1, index) : order.slice(index, current);
  return !crossed.some((subjectId) => referenceIds.has(subjectId));
};

export const rankedPlayerOrder = (order: readonly string[], referenceIds: ReadonlySet<string>) =>
  order.filter((id) => !referenceIds.has(id));

export const rankedAttributeResponses = (
  question: AttributeQuestion,
  order: readonly string[],
  sessionId: string,
  referenceIds: ReadonlySet<string>,
  batchId = createAttributeResponseId(),
  createdAt = Date.now(),
): PendingAttributeResponse[] => {
  const ranking = { version: 1 as const, orderedSubjectIds: [...order],
    referenceSubjectIds: order.filter((id) => referenceIds.has(id)) };
  const playerOrder = rankingPlayerOrder(ranking);
  if (playerOrder.length < 2) return [];
  const responseId = `${batchId}${RANKING_RESPONSE_ID_MARKER}ballot`;
  return [{
      id: responseId,
      responseId,
      subjectAId: playerOrder[0],
      subjectBId: playerOrder[1],
      attributeId: question.attribute.id,
      highPole: question.highPole,
      ranking,
      sessionId,
      createdAt,
  }];
};
