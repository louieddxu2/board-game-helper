import type { AttributeActivity } from '../../src/shared/types';
import { rankingPlayerOrder } from '../../src/shared/attributeRankingBallot';
import { attributeVoteWeight } from './attributeVoteWeights';
import { D1_SAFE_BOUND_PARAMETER_COUNT, votableSubjectCondition, type AttributeResponseInput } from './attributeQueryShared';
import type { Database } from './database';

/** Validate mutable eligibility inside the receipt transaction, without score locks. */
export const insertAttributeResponseReceipt = async (
  db: Database, input: AttributeResponseInput, activities: AttributeActivity[],
) => {
  const ids = input.ranking ? rankingPlayerOrder(input.ranking) : [input.subjectAId, input.subjectBId];
  // Known small ID lists use direct PK lookups without a JSON virtual table.
  // Large rankings retain the bounded-parameter JSON path.
  const bindIds = ids.length <= D1_SAFE_BOUND_PARAMETER_COUNT - 2;
  const subjects = bindIds ? 'attribute_subjects subject' : `json_each(?) requested
      CROSS JOIN attribute_subjects subject ON subject.id = requested.value`;
  const statements = [
    db.statement(`SELECT json_extract('{}', CASE WHEN (
      SELECT COUNT(*) FROM ${subjects}
      LEFT JOIN games game ON game.id = subject.game_id
      JOIN attributes attribute ON attribute.id = ? AND attribute.is_active = 1
      WHERE ${bindIds ? `subject.id IN (${ids.map(() => '?').join(', ')}) AND` : ''}
        ${votableSubjectCondition('subject', 'game')}
    ) = ? THEN '$' ELSE 'attribute_subject_not_found' END)`)
      .bind(...(bindIds ? [input.attributeId, ...ids, ids.length] : [JSON.stringify(ids), input.attributeId, ids.length])),
    // Explicit rowids remain beyond the scoring cursor even if an operator
    // deletes the last history row. Ordinary SQLite rowid reuse must not hide a vote.
    db.statement(`INSERT INTO attribute_vote_responses
      (rowid, response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
       comparison, activity_json, actor_id, session_id, created_at, updated_at,
       question_high_pole, recorded_online, ranking_json, online_weight)
      SELECT MAX(COALESCE((SELECT rowid FROM attribute_vote_responses ORDER BY rowid DESC LIMIT 1), 0),
        (SELECT through_rowid FROM attribute_online_progress WHERE id = 1)) + 1,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE true ON CONFLICT(response_id) DO NOTHING`)
      .bind(input.responseId, input.attributeId, input.ranking ? null : input.subjectAId,
        input.ranking ? null : input.subjectBId, input.ratingA ?? null, input.ratingB ?? null,
        input.comparison ?? null, JSON.stringify(activities), input.actorId, input.sessionId,
        input.timestamp, input.timestamp, input.highPole ?? 'high', input.ranking
          ? JSON.stringify({ ...input.ranking, highPole: input.highPole ?? 'high' }) : null,
        attributeVoteWeight(input.actorId, input.actorIsAuthorized)),
  ];
  try { await db.batch(statements); }
  catch (error) {
    if (error instanceof Error && error.message.includes('attribute_subject_not_found')) throw new Error('attribute_subject_not_found');
    throw error;
  }
};
