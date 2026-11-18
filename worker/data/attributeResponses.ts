import { canonicalAttributeAnswer, parseAttributeScale } from '../../src/shared/attributeScale';
import type {
  AttributeActivity,
  AttributeComparisonResult,
  AttributeMatrixValue
} from '../../src/shared/types';
import { createId } from '../utils';
import type { AttributeWriteLock } from './attributeLocks';
import type { AttributeResponseInput, SavedAttributeResponse } from './attributeQueryShared';
import { canonicalizeComparison, responseContextAndStates, stateToMatrixValue, toResponseActivitySubject } from './attributeResponseContext';
import {
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  type OnlineAttributeState
} from './attributeScoring';
import type { Database } from './database';
import { attributeVoteWeight } from './attributeVoteWeights';
import { acquireAttributeWriteLock, attributeScoreUpsert, commitAttributeResponse, releaseAttributeWriteLock } from './attributeResponseStorage';
import { saveAttributeRankingLocked, validateAttributeRankingInput } from './attributeRankingResponses';

const saveAttributeResponseLocked = async (
  db: Database,
  input: AttributeResponseInput,
  lock: AttributeWriteLock,
): Promise<SavedAttributeResponse> => {
  const { context, states: stateMap } = await responseContextAndStates(db, input);
  // Replay sorts by timestamp and ID. Equal or older timestamps can make a
  // live comparison differ from that order; numeric answers already mark
  // replay pending through the response-insert trigger.
  const comparisonOutOfOrder = input.comparison != null && input.ratingA == null && input.ratingB == null
    && Math.max(Number(context.state_a_updated_at ?? 0), Number(context.state_b_updated_at ?? 0)) >= input.timestamp;
  if (input.highPole === 'low' && context.scale_type !== 'bipolar') throw new Error('attribute_question_invalid');
  input = canonicalAttributeAnswer(input);
  const weight = attributeVoteWeight(input.actorId, input.actorIsAuthorized);
  let stateA = stateMap.get(input.subjectAId) ?? emptyAttributeState();
  let stateB = stateMap.get(input.subjectBId) ?? emptyAttributeState();
  const touchedSubjects = new Set<string>();

  if (input.ratingA != null) {
    stateA = applyDirectRating(stateA, input.ratingA, weight).next;
    touchedSubjects.add(input.subjectAId);
  }
  if (input.ratingB != null) {
    stateB = applyDirectRating(stateB, input.ratingB, weight).next;
    touchedSubjects.add(input.subjectBId);
  }

  const canonical = input.comparison == null ? undefined : canonicalizeComparison(input.subjectAId, input.subjectBId, input.comparison);
  if (input.comparison != null) {
    const updated = applyComparison(stateA, stateB, input.comparison, weight);
    stateA = updated.a.next;
    stateB = updated.b.next;
    touchedSubjects.add(input.subjectAId);
    touchedSubjects.add(input.subjectBId);
  }

  const statements = [];
  const activities: AttributeActivity[] = [];
  const activityEndpoints = parseAttributeScale(context.scale_type, context.endpoints_json ? JSON.parse(context.endpoints_json) : undefined).endpoints;
  const attributePoles = activityEndpoints ? { low: activityEndpoints.low.label, high: activityEndpoints.high.label } : undefined;
  const addActivity = (kind: 'rating' | 'comparison', subjectAId: string, subjectBId: string | null, value: number | null, result: AttributeComparisonResult | null) => {
    const id = createId('attribute-vote');
    if (kind === 'rating') {
      const subject = subjectAId === context.subject_a_id
        ? toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug)
        : toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug);
      activities.push({ id, kind, actorName: context.actor_name, attributeId: input.attributeId, attributeName: context.attribute_name, attributePoles, subject, value: value ?? undefined, createdAt: input.timestamp });
    } else {
      const subjectA = subjectAId === context.subject_a_id
        ? toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug)
        : toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug);
      const subjectB = subjectBId === context.subject_b_id
        ? toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug)
        : toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug);
      activities.push({ id, kind, actorName: context.actor_name, attributeId: input.attributeId, attributeName: context.attribute_name, attributePoles, subjectA, subjectB, result: result ?? undefined, createdAt: input.timestamp });
    }
  };

  if (input.ratingA != null) addActivity('rating', input.subjectAId, null, input.ratingA, null);
  if (input.ratingB != null) addActivity('rating', input.subjectBId, null, input.ratingB, null);
  if (canonical) addActivity('comparison', canonical.subjectAId, canonical.subjectBId, null, canonical.result);

  const addStateUpsert = (subjectId: string, state: OnlineAttributeState) => {
    statements.push(attributeScoreUpsert(db, subjectId, input.attributeId, state, input.timestamp));
  };
  if (touchedSubjects.has(input.subjectAId)) addStateUpsert(input.subjectAId, stateA);
  if (touchedSubjects.has(input.subjectBId)) addStateUpsert(input.subjectBId, stateB);

  statements.push(db.statement(`
    INSERT INTO attribute_vote_responses
      (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
       comparison, activity_json, actor_id, session_id, created_at, updated_at, question_high_pole, recorded_online)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    input.responseId,
    input.attributeId,
    input.subjectAId,
    input.subjectBId,
    input.ratingA ?? null,
    input.ratingB ?? null,
    input.comparison ?? null,
    JSON.stringify(activities),
    input.actorId,
    input.sessionId,
    input.timestamp,
    input.timestamp,
    input.highPole ?? 'high',
  ));
  if (comparisonOutOfOrder) {
    statements.push(db.statement(`
      UPDATE attribute_replay_status SET required_revision = required_revision + 1 WHERE id = 1
    `));
  }
  await commitAttributeResponse(db, lock, statements);

  const updatedValues: AttributeMatrixValue[] = [];
  if (touchedSubjects.has(input.subjectAId)) updatedValues.push(stateToMatrixValue(input.subjectAId, input.attributeId, stateA));
  if (touchedSubjects.has(input.subjectBId)) updatedValues.push(stateToMatrixValue(input.subjectBId, input.attributeId, stateB));
  return { updatedValues, activities };
};

export const saveAttributeResponse = async (db: Database, input: AttributeResponseInput): Promise<SavedAttributeResponse> => {
  validateAttributeRankingInput(input);
  if (input.subjectAId === input.subjectBId) throw new Error('attribute_subjects_must_differ');
  if (!input.ranking && input.comparison == null && input.ratingA == null && input.ratingB == null) throw new Error('attribute_response_empty');

  const lock = await acquireAttributeWriteLock(db, input);
  let lockReleasedInCommit = false;
  try {
    const lockedExistingResponse = await db.statement('SELECT response_id FROM attribute_vote_responses WHERE response_id = ? LIMIT 1')
      .bind(input.responseId)
      .first<{ response_id: string }>();
    if (lockedExistingResponse) return { updatedValues: [], activities: [] };
    const result = input.ranking
      ? await saveAttributeRankingLocked(db, input, lock)
      : await saveAttributeResponseLocked(db, input, lock);
    lockReleasedInCommit = true;
    return result;
  } finally {
    if (!lockReleasedInCommit) await releaseAttributeWriteLock(db, lock).run();
  }
};
