import { z } from 'zod';
import type { AttributeComparisonResult, AttributePole } from './attributeTypes';

export const attributeRankingBallotSchema = z.object({
  version: z.literal(1),
  orderedSubjectIds: z.array(z.string().trim().min(1).max(200)).min(2),
  referenceSubjectIds: z.array(z.string().trim().min(1).max(200)),
}).superRefine((ballot, context) => {
  const order = new Set(ballot.orderedSubjectIds);
  const references = new Set(ballot.referenceSubjectIds);
  if (order.size !== ballot.orderedSubjectIds.length || references.size !== ballot.referenceSubjectIds.length
    || ballot.referenceSubjectIds.some((id) => !order.has(id)) || order.size - references.size < 2) {
    context.addIssue({ code: 'custom', message: 'invalid_attribute_ranking' });
  }
});

export type AttributeRankingBallot = z.infer<typeof attributeRankingBallotSchema>;
export type StoredAttributeRankingBallot = AttributeRankingBallot & {
  highPole: AttributePole;
  subjectMappings?: Record<string, string>;
};

export const rankingPlayerOrder = (ballot: AttributeRankingBallot) => {
  const references = new Set(ballot.referenceSubjectIds);
  return [...new Set(ballot.orderedSubjectIds)].filter((id) => !references.has(id));
};

/** The existing center-out adjacent policy, shared by live scoring and replay. */
export const rankingComparisons = (ballot: AttributeRankingBallot & { subjectMappings?: Record<string, string> }, highPole: AttributePole = 'high') => {
  const order = rankingPlayerOrder(ballot);
  const middle = order.length - 2;
  return Array.from({ length: Math.max(0, order.length - 1) }, (_, index) => index)
    .sort((a, b) => Math.abs(2 * a - middle) - Math.abs(2 * b - middle) || a - b)
    .map((edge) => ({ subjectAId: ballot.subjectMappings?.[order[edge]] ?? order[edge],
      subjectBId: ballot.subjectMappings?.[order[edge + 1]] ?? order[edge + 1],
      comparison: (highPole === 'low' ? 'B_HIGHER' : 'A_HIGHER') as AttributeComparisonResult }));
};

export const rankingComparisonId = (responseId: string, index: number) =>
  `${responseId}:${String(index).padStart(6, '0')}`;

interface StoredResponse {
  response_id: string;
  subject_a_id: string | null;
  subject_b_id: string | null;
  rating_a: number | null;
  rating_b: number | null;
  comparison: AttributeComparisonResult | null;
  ranking_json?: string | null;
}

/** Expand only in Worker memory. The durable source remains one full ballot. */
export const expandStoredRankingResponse = <T extends StoredResponse>(row: T): T[] => {
  if (!row.ranking_json) return [row];
  const ballot = JSON.parse(row.ranking_json) as StoredAttributeRankingBallot;
  if (ballot.version !== 1) throw new Error('unsupported_attribute_ranking_version');
  return rankingComparisons(ballot, ballot.highPole).map((comparison, index) => ({
    ...row, response_id: rankingComparisonId(row.response_id, index), ranking_json: null,
    subject_a_id: comparison.subjectAId, subject_b_id: comparison.subjectBId,
    rating_a: null, rating_b: null, comparison: comparison.comparison,
  }));
};
