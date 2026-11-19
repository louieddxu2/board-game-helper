import { attributeRankingBallotSchema, rankingComparisons, rankingComparisonId, rankingPlayerOrder } from '../../src/shared/attributeRankingBallot';
import { parseAttributeScale } from '../../src/shared/attributeScale';
import type { AttributeActivity } from '../../src/shared/types';
import { createId } from '../utils';
import { canonicalizeComparison, toResponseActivitySubject } from './attributeResponseContext';
import type { AttributeResponseInput } from './attributeQueryShared';
import { insertAttributeResponseReceipt } from './attributeResponseReceipt';
import type { Database } from './database';

interface RankingSubjectRow {
  subject_id: string; display_name: string; slug: string; game_slug: string | null; game_id: string | null;
  attribute_name: string; scale_type: string; endpoints_json: string | null; actor_name: string;
}

export const validateAttributeRankingInput = (input: AttributeResponseInput) => {
  if (!input.ranking) return;
  const ballot = attributeRankingBallotSchema.safeParse(input.ranking);
  if (!ballot.success) throw new Error('invalid_attribute_ranking');
  const players = rankingPlayerOrder(ballot.data);
  if (input.comparison != null || input.ratingA != null || input.ratingB != null
    || input.subjectAId !== players[0] || input.subjectBId !== players[1]) throw new Error('invalid_attribute_ranking');
};

export const saveAttributeRankingReceipt = async (
  db: Database, input: AttributeResponseInput,
): Promise<AttributeActivity[]> => {
  const ranking = input.ranking!;
  const players = rankingPlayerOrder(ranking);
  const result = await db.statement(`
    SELECT subject.id AS subject_id, subject.display_name, subject.slug, subject.game_id, game.slug AS game_slug,
      translation.name AS attribute_name, attribute.scale_type, translation.endpoints_json,
      CASE WHEN actor.show_nickname = 1 AND actor.nickname IS NOT NULL THEN actor.nickname ELSE '匿名玩家' END AS actor_name
    FROM attributes attribute
    JOIN attribute_translations translation ON translation.attribute_id = attribute.id AND translation.locale = 'zh-TW'
    CROSS JOIN json_each(?) requested
    CROSS JOIN attribute_subjects subject ON subject.id = requested.value
    LEFT JOIN games game ON game.id = subject.game_id
    LEFT JOIN users actor ON actor.id = ?
    WHERE attribute.id = ? AND attribute.is_active = 1
  `).bind(JSON.stringify(players), input.actorId, input.attributeId).all<RankingSubjectRow>();
  const rows = result.results ?? [];
  if (rows.length !== players.length) throw new Error('attribute_subject_not_found');
  const gameIds = rows.flatMap((row) => row.game_id ? [row.game_id] : []);
  if (new Set(gameIds).size !== gameIds.length) throw new Error('attribute_subjects_must_differ');
  const context = rows[0];
  if (input.highPole === 'low' && context.scale_type !== 'bipolar') throw new Error('attribute_question_invalid');
  const metadata = new Map(rows.map((row) => [row.subject_id, row]));
  const endpoints = parseAttributeScale(context.scale_type, context.endpoints_json ? JSON.parse(context.endpoints_json) : undefined).endpoints;
  const attributePoles = endpoints ? { low: endpoints.low.label, high: endpoints.high.label } : undefined;
  const activitySubject = (id: string) => {
    const subject = metadata.get(id)!;
    return toResponseActivitySubject(id, subject.display_name, subject.slug, subject.game_slug);
  };
  const activities: AttributeActivity[] = [];
  for (const [index, comparison] of rankingComparisons(ranking, input.highPole).entries()) {
    const { subjectAId, subjectBId } = comparison;
    const canonical = canonicalizeComparison(subjectAId, subjectBId, comparison.comparison);
    activities.push({ id: createId('attribute-vote'), responseId: rankingComparisonId(input.responseId, index),
      kind: 'comparison', actorName: context.actor_name, attributeId: input.attributeId, attributeName: context.attribute_name,
      attributePoles, subjectA: activitySubject(canonical.subjectAId), subjectB: activitySubject(canonical.subjectBId),
      result: canonical.result, createdAt: input.timestamp });
  }
  await insertAttributeResponseReceipt(db, input, activities);
  return activities;
};
