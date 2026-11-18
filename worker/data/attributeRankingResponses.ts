import { attributeRankingBallotSchema, rankingComparisons, rankingComparisonId, rankingPlayerOrder } from '../../src/shared/attributeRankingBallot';
import { parseAttributeScale } from '../../src/shared/attributeScale';
import type { AttributeActivity } from '../../src/shared/types';
import { createId } from '../utils';
import type { AttributeWriteLock } from './attributeLocks';
import { canonicalizeComparison, stateToMatrixValue, toResponseActivitySubject } from './attributeResponseContext';
import { attributeScoreUpsert, commitAttributeResponse } from './attributeResponseStorage';
import { applyComparison, emptyAttributeState, type OnlineAttributeState } from './attributeScoring';
import { votableSubjectCondition, type AttributeResponseInput, type SavedAttributeResponse } from './attributeQueryShared';
import { attributeVoteWeight } from './attributeVoteWeights';
import type { Database } from './database';

interface RankingSubjectRow {
  subject_id: string; display_name: string; slug: string; game_slug: string | null; game_id: string | null;
  attribute_name: string; scale_type: string; endpoints_json: string | null; actor_name: string;
  score: number | null; rating_deviation: number | null; direct_sum: number | null; direct_count: number | null;
  comparison_count: number | null; decisive_comparison_count: number | null; evidence_count: number | null;
  state_updated_at: number | null;
}

export const validateAttributeRankingInput = (input: AttributeResponseInput) => {
  if (!input.ranking) return;
  const ballot = attributeRankingBallotSchema.safeParse(input.ranking);
  if (!ballot.success) throw new Error('invalid_attribute_ranking');
  const players = rankingPlayerOrder(ballot.data);
  if (input.comparison != null || input.ratingA != null || input.ratingB != null
    || input.subjectAId !== players[0] || input.subjectBId !== players[1]) throw new Error('invalid_attribute_ranking');
};

export const saveAttributeRankingLocked = async (
  db: Database, input: AttributeResponseInput, lock: AttributeWriteLock,
): Promise<SavedAttributeResponse> => {
  const ranking = input.ranking!;
  const players = rankingPlayerOrder(ranking);
  const result = await db.statement(`
    SELECT subject.id AS subject_id, subject.display_name, subject.slug, subject.game_id, game.slug AS game_slug,
      translation.name AS attribute_name, attribute.scale_type, translation.endpoints_json,
      CASE WHEN actor.show_nickname = 1 AND actor.nickname IS NOT NULL THEN actor.nickname ELSE '匿名玩家' END AS actor_name,
      state.score, state.rating_deviation, state.direct_sum, state.direct_count,
      state.comparison_count, state.decisive_comparison_count, state.evidence_count, state.updated_at AS state_updated_at
    FROM attribute_subjects subject
    JOIN attributes attribute ON attribute.id = ? AND attribute.is_active = 1
    JOIN attribute_translations translation ON translation.attribute_id = attribute.id AND translation.locale = 'zh-TW'
    LEFT JOIN games game ON game.id = subject.game_id
    LEFT JOIN users actor ON actor.id = ?
    LEFT JOIN attribute_score_states state ON state.subject_id = subject.id AND state.attribute_id = attribute.id
    WHERE subject.id IN (SELECT value FROM json_each(?)) AND ${votableSubjectCondition('subject', 'game')}
  `).bind(input.attributeId, input.actorId, JSON.stringify(players)).all<RankingSubjectRow>();
  const rows = result.results ?? [];
  if (rows.length !== players.length) throw new Error('attribute_subject_not_found');
  const gameIds = rows.flatMap((row) => row.game_id ? [row.game_id] : []);
  if (new Set(gameIds).size !== gameIds.length) throw new Error('attribute_subjects_must_differ');
  const context = rows[0];
  if (input.highPole === 'low' && context.scale_type !== 'bipolar') throw new Error('attribute_question_invalid');
  const metadata = new Map(rows.map((row) => [row.subject_id, row]));
  const states = new Map<string, OnlineAttributeState>(rows.map((row) => [row.subject_id, row.score == null
    ? emptyAttributeState()
    : { score: row.score, ratingDeviation: Number(row.rating_deviation), directSum: Number(row.direct_sum),
      directCount: Number(row.direct_count), comparisonCount: Number(row.comparison_count),
      decisiveComparisonCount: Number(row.decisive_comparison_count), evidenceCount: Number(row.evidence_count) }]));
  const endpoints = parseAttributeScale(context.scale_type, context.endpoints_json ? JSON.parse(context.endpoints_json) : undefined).endpoints;
  const attributePoles = endpoints ? { low: endpoints.low.label, high: endpoints.high.label } : undefined;
  const activitySubject = (id: string) => {
    const subject = metadata.get(id)!;
    return toResponseActivitySubject(id, subject.display_name, subject.slug, subject.game_slug);
  };
  const weight = attributeVoteWeight(input.actorId, input.actorIsAuthorized);
  const activities: AttributeActivity[] = [];
  for (const [index, comparison] of rankingComparisons(ranking, input.highPole).entries()) {
    const { subjectAId, subjectBId } = comparison;
    const updated = applyComparison(states.get(subjectAId)!, states.get(subjectBId)!, comparison.comparison, weight);
    states.set(subjectAId, updated.a.next);
    states.set(subjectBId, updated.b.next);
    const canonical = canonicalizeComparison(subjectAId, subjectBId, comparison.comparison);
    activities.push({ id: createId('attribute-vote'), responseId: rankingComparisonId(input.responseId, index),
      kind: 'comparison', actorName: context.actor_name, attributeId: input.attributeId, attributeName: context.attribute_name,
      attributePoles, subjectA: activitySubject(canonical.subjectAId), subjectB: activitySubject(canonical.subjectBId),
      result: canonical.result, createdAt: input.timestamp });
  }
  const statements = [...states].map(([id, state]) => attributeScoreUpsert(db, id, input.attributeId, state, input.timestamp));
  statements.push(db.statement(`
    INSERT INTO attribute_vote_responses
      (response_id, attribute_id, activity_json, actor_id, session_id, created_at, updated_at,
       question_high_pole, recorded_online, ranking_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(input.responseId, input.attributeId, JSON.stringify(activities), input.actorId, input.sessionId,
    input.timestamp, input.timestamp, input.highPole ?? 'high', JSON.stringify({ ...ranking, highPole: input.highPole ?? 'high' })));
  if (rows.some((row) => Number(row.state_updated_at ?? 0) >= input.timestamp)) {
    statements.push(db.statement('UPDATE attribute_replay_status SET required_revision = required_revision + 1 WHERE id = 1'));
  }
  await commitAttributeResponse(db, lock, statements);
  return { updatedValues: [...states].map(([id, state]) => stateToMatrixValue(id, input.attributeId, state)), activities };
};
