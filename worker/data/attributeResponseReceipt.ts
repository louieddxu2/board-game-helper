import type { AttributeActivity } from '../../src/shared/types';
import { rankingPlayerOrder } from '../../src/shared/attributeRankingBallot';
import { attributeVoteWeight } from './attributeVoteWeights';
import { votableSubjectCondition, type AttributeResponseInput } from './attributeQueryShared';
import type { Database } from './database';

/** Revalidate mutable subjects inside the receipt transaction, without score locks. */
export const insertAttributeResponseReceipt = async (
  db: Database, input: AttributeResponseInput, activities: AttributeActivity[],
) => {
  const ids = input.ranking ? rankingPlayerOrder(input.ranking) : [input.subjectAId, input.subjectBId];
  const statements = [
    db.statement(`SELECT json_extract('{}', CASE WHEN (
      SELECT COUNT(*) FROM json_each(?) requested
      CROSS JOIN attribute_subjects subject ON subject.id = requested.value
      LEFT JOIN games game ON game.id = subject.game_id
      JOIN attributes attribute ON attribute.id = ? AND attribute.is_active = 1
      WHERE ${votableSubjectCondition('subject', 'game')}
    ) = ? THEN '$' ELSE 'attribute_subject_not_found' END)`)
      .bind(JSON.stringify(ids), input.attributeId, ids.length),
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
