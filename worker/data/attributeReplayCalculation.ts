import type { AttributeComparisonResult } from '../../src/shared/types';
import { ATTRIBUTE_INITIAL_RD, applyComparison, emptyAttributeState, type OnlineAttributeState } from './attributeScoring';

interface AttributeReplayBaselineRow {
  direct_sum: number;
  direct_count: number;
  weighted_sum?: number;
  weight_sum?: number;
}

export const mergeStateKey = (subjectId: string, attributeId: string) => `${subjectId}\u0000${attributeId}`;

const stateFromBaseline = (row: AttributeReplayBaselineRow): OnlineAttributeState => {
  const directCount = Number(row.direct_count);
  const directSum = Number(row.direct_sum);
  return {
    score: directCount ? (row.weighted_sum ?? directSum) / (row.weight_sum ?? directCount) : 5,
    ratingDeviation: directCount ? 1.5 / Math.sqrt(row.weight_sum ?? directCount) : ATTRIBUTE_INITIAL_RD,
    directSum,
    directCount,
    comparisonCount: 0,
    decisiveComparisonCount: 0,
    evidenceCount: directCount,
  };
};

export const pairStatKey = (subjectAId: string, subjectBId: string, attributeId: string) =>
  `${subjectAId}\u0000${subjectBId}\u0000${attributeId}`;

interface FullReplayHistoryRow {
  stream_id: string;
  kind: 'rating' | 'comparison';
  attribute_id: string;
  subject_a_id: string;
  subject_b_id: string | null;
  value: number | null;
  comparison: AttributeComparisonResult | null;
  created_at: number;
  weight: number;
}

export interface FullReplayResponseRow {
  response_id: string;
  attribute_id: string;
  subject_a_id: string;
  subject_b_id: string | null;
  rating_a: number | null;
  rating_b: number | null;
  comparison: AttributeComparisonResult | null;
  created_at: number;
  weight: number;
}

export type ReplayPair = { subjectAId: string; subjectBId: string; attributeId: string; count: number };

export interface CalculatedAttributeReplay {
  states: Map<string, OnlineAttributeState>;
  pairCounts: Map<string, ReplayPair>;
}

const expandAttributeReplayHistory = (responses: FullReplayResponseRow[]): FullReplayHistoryRow[] => {
  const history: FullReplayHistoryRow[] = [];
  for (const row of responses) {
    if (row.rating_a != null) history.push({ stream_id: `response:${row.response_id}:rating-a`, kind: 'rating', attribute_id: row.attribute_id, subject_a_id: row.subject_a_id, subject_b_id: null, value: row.rating_a, comparison: null, created_at: row.created_at, weight: row.weight });
    if (row.rating_b != null && row.subject_b_id) history.push({ stream_id: `response:${row.response_id}:rating-b`, kind: 'rating', attribute_id: row.attribute_id, subject_a_id: row.subject_b_id, subject_b_id: null, value: row.rating_b, comparison: null, created_at: row.created_at, weight: row.weight });
    if (row.comparison && row.subject_b_id) history.push({ stream_id: `response:${row.response_id}:comparison`, kind: 'comparison', attribute_id: row.attribute_id, subject_a_id: row.subject_a_id, subject_b_id: row.subject_b_id, value: null, comparison: row.comparison, created_at: row.created_at, weight: row.weight });
  }
  return history.sort((left, right) => left.created_at - right.created_at || left.stream_id.localeCompare(right.stream_id));
};

export const calculateAttributeReplay = (
  subjectIds: ReadonlySet<string>,
  attributeIds: ReadonlySet<string>,
  responses: FullReplayResponseRow[],
): CalculatedAttributeReplay => {
  const history = expandAttributeReplayHistory(responses);
  const states = new Map<string, OnlineAttributeState>();
  const directRatings = new Map<string, { total: number; count: number; weightedTotal: number; weight: number }>();
  for (const row of history) {
    if (row.kind !== 'rating' || row.value == null || !subjectIds.has(row.subject_a_id) || !attributeIds.has(row.attribute_id)) continue;
    const key = mergeStateKey(row.subject_a_id, row.attribute_id);
    const direct = directRatings.get(key) ?? { total: 0, count: 0, weightedTotal: 0, weight: 0 };
    direct.total += Number(row.value); direct.count += 1;
    direct.weightedTotal += Number(row.value) * row.weight; direct.weight += row.weight;
    directRatings.set(key, direct);
  }
  for (const subjectId of subjectIds) for (const attributeId of attributeIds) {
    const direct = directRatings.get(mergeStateKey(subjectId, attributeId));
    states.set(mergeStateKey(subjectId, attributeId), stateFromBaseline({
      direct_sum: direct?.total ?? 0, direct_count: direct?.count ?? 0,
      weighted_sum: direct?.weightedTotal ?? 0, weight_sum: direct?.weight ?? 0,
    }));
  }
  const pairCounts = new Map<string, ReplayPair>();
  for (const row of history) {
    if (row.kind !== 'comparison' || !row.comparison || !row.subject_b_id || !subjectIds.has(row.subject_a_id) || !subjectIds.has(row.subject_b_id) || !attributeIds.has(row.attribute_id) || row.subject_a_id === row.subject_b_id) continue;
    const keyA = mergeStateKey(row.subject_a_id, row.attribute_id);
    const keyB = mergeStateKey(row.subject_b_id, row.attribute_id);
    const updated = applyComparison(states.get(keyA) ?? emptyAttributeState(), states.get(keyB) ?? emptyAttributeState(), row.comparison, row.weight);
    states.set(keyA, updated.a.next); states.set(keyB, updated.b.next);
    const [subjectAId, subjectBId] = row.subject_a_id < row.subject_b_id ? [row.subject_a_id, row.subject_b_id] : [row.subject_b_id, row.subject_a_id];
    const key = pairStatKey(subjectAId, subjectBId, row.attribute_id);
    const pair = pairCounts.get(key);
    if (pair) pair.count += 1;
    else pairCounts.set(key, { subjectAId, subjectBId, attributeId: row.attribute_id, count: 1 });
  }
  return { states, pairCounts };
};
