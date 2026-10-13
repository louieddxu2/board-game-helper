import { canonicalAttributeAnswer, parseAttributeScale } from '../../src/shared/attributeScale';
import type {
  AttributeActivity,
  AttributeComparisonResult,
  AttributeMatrixValue
} from '../../src/shared/types';
import { createId } from '../utils';
import type { AttributeWriteLock } from './attributeLocks';
import { attributeWriteLockNames, batchChangeCount } from './attributeLocks';
import type { AttributeResponseInput, SavedAttributeResponse } from './attributeQueryShared';
import { ATTRIBUTE_REPLAY_LOCK_NAME, ATTRIBUTE_RESPONSE_LOCK_TTL_MS } from './attributeQueryShared';
import { canonicalizeComparison, randomQuestionSlot, responseContextAndStates, stateToMatrixValue, toResponseActivitySubject } from './attributeResponseContext';
import {
  ATTRIBUTE_SCORE_MODEL_VERSION,
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  type OnlineAttributeState
} from './attributeScoring';
import type { Database, DatabaseStatement } from './database';

const releaseAttributeWriteLock = async (db: Database, lock: AttributeWriteLock): Promise<void> => {
  if (!lock.names.length) return;
  await db.statement(`
    DELETE FROM attribute_vote_lock
    WHERE lock_name IN (${lock.names.map(() => '?').join(',')}) AND token = ?
  `).bind(...lock.names, lock.token).run();
};

const releaseAttributeWriteLockStatement = (db: Database, lock: AttributeWriteLock): DatabaseStatement => db.statement(`
  DELETE FROM attribute_vote_lock
  WHERE lock_name IN (${lock.names.map(() => '?').join(',')}) AND token = ?
`).bind(...lock.names, lock.token);

const acquireAttributeWriteLock = async (db: Database, input: AttributeResponseInput): Promise<AttributeWriteLock> => {
  const token = createId('attribute-lock');
  const names = attributeWriteLockNames(input);
  const now = Date.now();
  const expiresAt = Math.max(now, input.timestamp) + ATTRIBUTE_RESPONSE_LOCK_TTL_MS;
  const results = await db.batch([
    db.statement(`
      DELETE FROM attribute_vote_lock
      WHERE lock_name IN (${[...names, ATTRIBUTE_REPLAY_LOCK_NAME].map(() => '?').join(',')})
        AND expires_at < ?
    `).bind(...names, ATTRIBUTE_REPLAY_LOCK_NAME, now),
    ...names.map((name) => db.statement(`
      INSERT OR IGNORE INTO attribute_vote_lock (lock_name, token, expires_at)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM attribute_vote_lock
        WHERE lock_name = ? AND expires_at >= ?
      )
    `).bind(name, token, expiresAt, ATTRIBUTE_REPLAY_LOCK_NAME, now)),
  ]);
  const acquired = names.filter((_, index) => batchChangeCount(results[index + 1]) === 1);
  if (acquired.length !== names.length) {
    await releaseAttributeWriteLock(db, { token, names: acquired });
    throw new Error('attribute_response_busy');
  }
  return { token, names };
};

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
  let stateA = stateMap.get(input.subjectAId) ?? emptyAttributeState();
  let stateB = stateMap.get(input.subjectBId) ?? emptyAttributeState();
  const touchedSubjects = new Set<string>();

  if (input.ratingA != null) {
    stateA = applyDirectRating(stateA, input.ratingA).next;
    touchedSubjects.add(input.subjectAId);
  }
  if (input.ratingB != null) {
    stateB = applyDirectRating(stateB, input.ratingB).next;
    touchedSubjects.add(input.subjectBId);
  }

  const canonical = input.comparison == null ? undefined : canonicalizeComparison(input.subjectAId, input.subjectBId, input.comparison);
  if (input.comparison != null) {
    const updated = applyComparison(stateA, stateB, input.comparison);
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
    statements.push(db.statement(`
      INSERT INTO attribute_score_states
        (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
         comparison_count, decisive_comparison_count, evidence_count, model_version, updated_at, random_key, question_slot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, lower(hex(randomblob(16))), ?)
      ON CONFLICT(subject_id, attribute_id) DO UPDATE SET
        score = excluded.score,
        rating_deviation = excluded.rating_deviation,
        direct_sum = excluded.direct_sum,
        direct_count = excluded.direct_count,
        comparison_count = excluded.comparison_count,
        decisive_comparison_count = excluded.decisive_comparison_count,
        evidence_count = excluded.evidence_count,
        model_version = excluded.model_version,
        updated_at = excluded.updated_at
    `).bind(subjectId, input.attributeId, state.score, state.ratingDeviation, state.directSum, state.directCount, state.comparisonCount, state.decisiveComparisonCount, state.evidenceCount, ATTRIBUTE_SCORE_MODEL_VERSION, input.timestamp, randomQuestionSlot()));
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
  statements.push(releaseAttributeWriteLockStatement(db, lock));
  await db.batch(statements);

  const updatedValues: AttributeMatrixValue[] = [];
  if (touchedSubjects.has(input.subjectAId)) updatedValues.push(stateToMatrixValue(input.subjectAId, input.attributeId, stateA));
  if (touchedSubjects.has(input.subjectBId)) updatedValues.push(stateToMatrixValue(input.subjectBId, input.attributeId, stateB));
  return { updatedValues, activities };
};

export const saveAttributeResponse = async (db: Database, input: AttributeResponseInput): Promise<SavedAttributeResponse> => {
  if (input.subjectAId === input.subjectBId) throw new Error('attribute_subjects_must_differ');
  if (input.comparison == null && input.ratingA == null && input.ratingB == null) throw new Error('attribute_response_empty');

  const lock = await acquireAttributeWriteLock(db, input);
  let lockReleasedInCommit = false;
  try {
    const lockedExistingResponse = await db.statement('SELECT response_id FROM attribute_vote_responses WHERE response_id = ? LIMIT 1')
      .bind(input.responseId)
      .first<{ response_id: string }>();
    if (lockedExistingResponse) return { updatedValues: [], activities: [] };
    const result = await saveAttributeResponseLocked(db, input, lock);
    lockReleasedInCommit = true;
    return result;
  } finally {
    if (!lockReleasedInCommit) await releaseAttributeWriteLock(db, lock);
  }
};
