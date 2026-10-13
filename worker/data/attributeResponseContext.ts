import type {
  AttributeComparisonResult,
  AttributeMatrixValue
} from '../../src/shared/types';
import type { AttributeResponseInput, ResponseContextAndStateRow } from './attributeQueryShared';
import { ATTRIBUTE_QUESTION_SLOT_COUNT, votableSubjectCondition } from './attributeQueryShared';
import {
  ATTRIBUTE_INITIAL_RD,
  ATTRIBUTE_SCORE_MODEL_VERSION,
  type OnlineAttributeState
} from './attributeScoring';
import type { Database } from './database';

export const randomQuestionSlot = () => Math.floor(Math.random() * ATTRIBUTE_QUESTION_SLOT_COUNT) + 1;

export const canonicalizeComparison = (subjectAId: string, subjectBId: string, result: AttributeComparisonResult) => {
  if (subjectAId <= subjectBId) return { subjectAId, subjectBId, result };
  return {
    subjectAId: subjectBId,
    subjectBId: subjectAId,
    result: result === 'A_HIGHER' ? 'B_HIGHER' : result === 'B_HIGHER' ? 'A_HIGHER' : 'SIMILAR',
  } satisfies { subjectAId: string; subjectBId: string; result: AttributeComparisonResult };
};

export const toResponseActivitySubject = (id: string, displayName: string, slug: string, gameSlug: string | null) => ({
  id,
  displayName,
  slug,
  ...(gameSlug ? { gameSlug } : {}),
});

export const stateToMatrixValue = (subjectId: string, attributeId: string, state: OnlineAttributeState): AttributeMatrixValue => ({
  subjectId,
  attributeId,
  score: Number(state.score.toFixed(2)),
  ratingDeviation: Number(state.ratingDeviation.toFixed(3)),
  directAverage: state.directCount ? Number((state.directSum / state.directCount).toFixed(2)) : undefined,
  directCount: state.directCount,
  comparisonCount: state.comparisonCount,
  decisiveComparisonCount: state.decisiveComparisonCount,
  evidenceCount: state.evidenceCount,
  modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
});

export const responseContextAndStates = async (db: Database, input: AttributeResponseInput) => {
  const row = await db.statement(`
    SELECT a.id AS attribute_id, t.name AS attribute_name, a.scale_type, t.endpoints_json,
      sa.id AS subject_a_id, sa.display_name AS subject_a_name, sa.slug AS subject_a_slug, ga.slug AS subject_a_game_slug,
      sb.id AS subject_b_id, sb.display_name AS subject_b_name, sb.slug AS subject_b_slug, gb.slug AS subject_b_game_slug,
      CASE WHEN u.show_nickname = 1 AND u.nickname IS NOT NULL THEN u.nickname ELSE '匿名玩家' END AS actor_name,
      ssa.subject_id AS state_a_subject_id, ssa.score AS state_a_score,
      ssa.rating_deviation AS state_a_rating_deviation, ssa.direct_sum AS state_a_direct_sum,
      ssa.direct_count AS state_a_direct_count, ssa.comparison_count AS state_a_comparison_count,
      ssa.decisive_comparison_count AS state_a_decisive_comparison_count,
      ssa.evidence_count AS state_a_evidence_count, ssa.updated_at AS state_a_updated_at,
      ssb.subject_id AS state_b_subject_id, ssb.score AS state_b_score,
      ssb.rating_deviation AS state_b_rating_deviation, ssb.direct_sum AS state_b_direct_sum,
      ssb.direct_count AS state_b_direct_count, ssb.comparison_count AS state_b_comparison_count,
      ssb.decisive_comparison_count AS state_b_decisive_comparison_count,
      ssb.evidence_count AS state_b_evidence_count, ssb.updated_at AS state_b_updated_at
    FROM attributes a
    JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
    JOIN attribute_subjects sa ON sa.id = ?
    JOIN attribute_subjects sb ON sb.id = ?
    LEFT JOIN games ga ON ga.id = sa.game_id
    LEFT JOIN games gb ON gb.id = sb.game_id
    LEFT JOIN attribute_score_states ssa ON ssa.subject_id = sa.id AND ssa.attribute_id = a.id
    LEFT JOIN attribute_score_states ssb ON ssb.subject_id = sb.id AND ssb.attribute_id = a.id
    LEFT JOIN users u ON u.id = ?
    WHERE a.id = ? AND a.is_active = 1
      AND ${votableSubjectCondition('sa', 'ga')}
      AND ${votableSubjectCondition('sb', 'gb')}
      AND (sa.game_id IS NULL OR sb.game_id IS NULL OR sa.game_id <> sb.game_id)
  `).bind(input.subjectAId, input.subjectBId, input.actorId, input.attributeId).first<ResponseContextAndStateRow>();
  if (!row) throw new Error('attribute_subject_not_found');

  const stateFor = (side: 'a' | 'b'): OnlineAttributeState | null => {
    const values = side === 'a'
      ? {
          subjectId: row.state_a_subject_id,
          score: row.state_a_score,
          ratingDeviation: row.state_a_rating_deviation,
          directSum: row.state_a_direct_sum,
          directCount: row.state_a_direct_count,
          comparisonCount: row.state_a_comparison_count,
          decisiveComparisonCount: row.state_a_decisive_comparison_count,
          evidenceCount: row.state_a_evidence_count,
        }
      : {
          subjectId: row.state_b_subject_id,
          score: row.state_b_score,
          ratingDeviation: row.state_b_rating_deviation,
          directSum: row.state_b_direct_sum,
          directCount: row.state_b_direct_count,
          comparisonCount: row.state_b_comparison_count,
          decisiveComparisonCount: row.state_b_decisive_comparison_count,
          evidenceCount: row.state_b_evidence_count,
        };
    if (!values.subjectId) return null;
    return {
      score: Number(values.score ?? 5),
      ratingDeviation: Number(values.ratingDeviation ?? ATTRIBUTE_INITIAL_RD),
      directSum: Number(values.directSum ?? 0),
      directCount: Number(values.directCount ?? 0),
      comparisonCount: Number(values.comparisonCount ?? 0),
      decisiveComparisonCount: Number(values.decisiveComparisonCount ?? 0),
      evidenceCount: Number(values.evidenceCount ?? 0),
    };
  };

  return {
    context: row,
    states: new Map([
      [input.subjectAId, stateFor('a')],
      [input.subjectBId, stateFor('b')],
    ].filter((entry): entry is [string, OnlineAttributeState] => entry[1] != null)),
  };
};
