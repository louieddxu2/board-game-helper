import { canonicalAttributeAnswer, parseAttributeScale } from '../../src/shared/attributeScale';
import type { AttributeActivity, AttributeComparisonResult } from '../../src/shared/types';
import { createId } from '../utils';
import type { AttributeResponseInput, SavedAttributeResponse } from './attributeQueryShared';
import { canonicalizeComparison, queryAttributeResponseContext, toResponseActivitySubject } from './attributeResponseContext';
import type { Database } from './database';
import { saveAttributeRankingReceipt, validateAttributeRankingInput } from './attributeRankingResponses';
import { insertAttributeResponseReceipt } from './attributeResponseReceipt';
import { hasPendingAttributeResponses, processAttributeResponses } from '../workflows/attributeOnlineScoring';

const savePairReceipt = async (db: Database, input: AttributeResponseInput): Promise<AttributeActivity[]> => {
  // Receipt validation deliberately does not read materialized score states.
  const context = await queryAttributeResponseContext(db, input);
  if (input.highPole === 'low' && context.scale_type !== 'bipolar') throw new Error('attribute_question_invalid');
  input = canonicalAttributeAnswer(input);
  const canonical = input.comparison == null ? undefined : canonicalizeComparison(input.subjectAId, input.subjectBId, input.comparison);
  const activities: AttributeActivity[] = [];
  const endpoints = parseAttributeScale(context.scale_type, context.endpoints_json ? JSON.parse(context.endpoints_json) : undefined).endpoints;
  const attributePoles = endpoints ? { low: endpoints.low.label, high: endpoints.high.label } : undefined;
  const subject = (id: string) => id === context.subject_a_id
    ? toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug)
    : toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug);
  const add = (kind: 'rating' | 'comparison', a: string, b: string | null, value: number | null, result: AttributeComparisonResult | null) => {
    const base = { id: createId('attribute-vote'), kind, actorName: context.actor_name, attributeId: input.attributeId,
      attributeName: context.attribute_name, attributePoles, createdAt: input.timestamp };
    activities.push(kind === 'rating'
      ? { ...base, kind: 'rating', subject: subject(a), value: value ?? undefined }
      : { ...base, kind: 'comparison', subjectA: subject(a), subjectB: subject(b!), result: result ?? undefined });
  };
  if (input.ratingA != null) add('rating', input.subjectAId, null, input.ratingA, null);
  if (input.ratingB != null) add('rating', input.subjectBId, null, input.ratingB, null);
  if (canonical) add('comparison', canonical.subjectAId, canonical.subjectBId, null, canonical.result);
  await insertAttributeResponseReceipt(db, input, activities);
  return activities;
};

/** A successful receipt is durable even when another scorer/replay owns the lease. */
export const saveAttributeResponse = async (db: Database, input: AttributeResponseInput): Promise<SavedAttributeResponse> => {
  validateAttributeRankingInput(input);
  if (input.subjectAId === input.subjectBId) throw new Error('attribute_subjects_must_differ');
  if (!input.ranking && input.comparison == null && input.ratingA == null && input.ratingB == null) throw new Error('attribute_response_empty');
  const existing = await db.statement('SELECT response_id FROM attribute_vote_responses WHERE response_id = ? LIMIT 1')
    .bind(input.responseId).first<{ response_id: string }>();
  if (existing && !await hasPendingAttributeResponses(db)) return { activities: [], updatedValues: [], scoreStatus: 'applied' };
  const activities = existing ? [] : input.ranking ? await saveAttributeRankingReceipt(db, input) : await savePairReceipt(db, input);
  try {
    // Only the lease owner waits or reads votes and scores.
    const scoring = await processAttributeResponses(db, { coalesceMs: 20 });
    return { activities, updatedValues: scoring.updatedValues,
      scoreStatus: scoring.status === 'busy' || scoring.status === 'pending' ? 'pending' : 'applied' };
  } catch (error) {
    // Receipt already committed. Server recovery resumes from the shared cursor.
    console.error('attribute_online_scoring_failed', error);
    return { activities, updatedValues: [], scoreStatus: 'pending' };
  }
};
