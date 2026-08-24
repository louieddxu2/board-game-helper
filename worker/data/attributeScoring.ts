import type { AttributeComparisonResult, AttributeMatrixValue } from '../../src/shared/types';

export const ATTRIBUTE_SCORE_MODEL_VERSION = 'comparison-blend-v1';

const DIRECT_RATING_SATURATION_COUNT = 3;
const COMPARISON_SATURATION_COUNT = 5;

export interface DirectRatingEvidence {
  subjectId: string;
  attributeId: string;
  average: number;
  count: number;
}

export interface ComparisonEvidence {
  subjectAId: string;
  subjectBId: string;
  attributeId: string;
  result: AttributeComparisonResult;
}

interface ComparisonAggregate {
  count: number;
  decisiveCount: number;
  net: number;
}

const evidenceKey = (subjectId: string, attributeId: string) => `${subjectId}\u0000${attributeId}`;

const roundScore = (value: number) => Number(value.toFixed(2));

const comparisonDelta = (result: AttributeComparisonResult) => result === 'SIMILAR' ? 0 : 1;

const blendScores = (directAverage: number | undefined, directCount: number, comparisonScore: number | undefined, decisiveComparisonCount: number) => {
  const directWeight = directAverage == null ? 0 : Math.min(1, directCount / DIRECT_RATING_SATURATION_COUNT);
  const comparisonWeight = comparisonScore == null ? 0 : Math.min(1, decisiveComparisonCount / COMPARISON_SATURATION_COUNT);
  const totalWeight = directWeight + comparisonWeight;
  if (!totalWeight) return undefined;
  return ((directAverage == null ? 0 : directAverage * directWeight)
    + (comparisonScore == null ? 0 : comparisonScore * comparisonWeight)) / totalWeight;
};

export const calculateAttributeScores = (
  ratings: DirectRatingEvidence[],
  comparisons: ComparisonEvidence[],
): AttributeMatrixValue[] => {
  const directByKey = new Map<string, DirectRatingEvidence>();
  ratings.forEach((rating) => directByKey.set(evidenceKey(rating.subjectId, rating.attributeId), rating));

  const comparisonsByKey = new Map<string, ComparisonAggregate>();
  const ensureAggregate = (subjectId: string, attributeId: string) => {
    const key = evidenceKey(subjectId, attributeId);
    const existing = comparisonsByKey.get(key);
    if (existing) return existing;
    const created = { count: 0, decisiveCount: 0, net: 0 };
    comparisonsByKey.set(key, created);
    return created;
  };

  comparisons.forEach((comparison) => {
    const delta = comparisonDelta(comparison.result);
    const a = ensureAggregate(comparison.subjectAId, comparison.attributeId);
    const b = ensureAggregate(comparison.subjectBId, comparison.attributeId);
    a.count += 1;
    b.count += 1;
    if (delta !== 0) {
      a.decisiveCount += 1;
      b.decisiveCount += 1;
      a.net += comparison.result === 'A_HIGHER' ? 1 : -1;
      b.net -= comparison.result === 'A_HIGHER' ? 1 : -1;
    }
  });

  const keys = new Set([...directByKey.keys(), ...comparisonsByKey.keys()]);
  return [...keys].flatMap((key) => {
    const direct = directByKey.get(key);
    const comparison = comparisonsByKey.get(key);
    const comparisonScore = comparison && comparison.decisiveCount > 0
      ? 5 + (5 * comparison.net / Math.max(COMPARISON_SATURATION_COUNT, comparison.decisiveCount))
      : undefined;
    const score = blendScores(direct?.average, direct?.count ?? 0, comparisonScore, comparison?.decisiveCount ?? 0);
    if (score == null) return [];
    const separator = key.indexOf('\u0000');
    const subjectId = key.slice(0, separator);
    const attributeId = key.slice(separator + 1);
    return [{
      subjectId,
      attributeId,
      score: roundScore(score),
      directAverage: direct ? roundScore(direct.average) : undefined,
      directCount: direct?.count ?? 0,
      comparisonCount: comparison?.count ?? 0,
      decisiveComparisonCount: comparison?.decisiveCount ?? 0,
      comparisonScore: comparisonScore == null ? undefined : roundScore(comparisonScore),
      modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
    }];
  });
};
