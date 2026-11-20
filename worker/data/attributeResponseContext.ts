import type {
  AttributeComparisonResult,
  AttributeMatrixValue
} from '../../src/shared/types';
import type { AttributeResponseInput, ResponseContextRow } from './attributeQueryShared';
import {
  ATTRIBUTE_SCORE_MODEL_VERSION,
  type OnlineAttributeState
} from './attributeScoring';
import type { Database } from './database';

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

export const queryAttributeActorName = async (db: Database, input: AttributeResponseInput): Promise<string> => {
  if (!input.actorId) return '匿名玩家';
  if (input.actorName !== undefined) return input.actorName;
  // Internal callers without a session snapshot retain the existing behavior.
  const actor = await db.statement('SELECT nickname, show_nickname FROM users WHERE id = ?')
    .bind(input.actorId).first<{ nickname: string | null; show_nickname: number }>();
  return actor?.show_nickname && actor.nickname != null ? actor.nickname : '匿名玩家';
};

export const queryAttributeResponseContext = async (db: Database, input: AttributeResponseInput) => {
  const row = await db.statement(`
    SELECT a.id AS attribute_id, t.name AS attribute_name, a.scale_type, t.endpoints_json,
      sa.id AS subject_a_id, sa.display_name AS subject_a_name, sa.slug AS subject_a_slug, ga.slug AS subject_a_game_slug,
      sb.id AS subject_b_id, sb.display_name AS subject_b_name, sb.slug AS subject_b_slug, gb.slug AS subject_b_game_slug
    FROM attributes a
    JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
    JOIN attribute_subjects sa ON sa.id = ?
    JOIN attribute_subjects sb ON sb.id = ?
    LEFT JOIN games ga ON ga.id = sa.game_id
    LEFT JOIN games gb ON gb.id = sb.game_id
    WHERE a.id = ? AND a.is_active = 1
      AND (sa.game_id IS NULL OR sb.game_id IS NULL OR sa.game_id <> sb.game_id)
  `).bind(input.subjectAId, input.subjectBId, input.attributeId).first<Omit<ResponseContextRow, 'actor_name'>>();
  if (!row) throw new Error('attribute_subject_not_found');

  return { ...row, actor_name: await queryAttributeActorName(db, input) };
};
