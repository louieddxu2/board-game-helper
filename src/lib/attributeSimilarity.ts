import type { AttributeMatrixValue } from '../shared/types';

const MAX_RATING_DEVIATION = 3;

export interface AttributeSimilarityMatch {
  subjectId: string;
  distance: number;
  coverage: number;
  sharedAttributeCount: number;
  rankCost: number;
}

const evidenceCount = (value: AttributeMatrixValue) =>
  value.evidenceCount ?? value.directCount + value.comparisonCount;

const confidence = (value: AttributeMatrixValue | undefined) => {
  if (!value || evidenceCount(value) <= 0) return 0;
  const deviation = Math.min(MAX_RATING_DEVIATION, Math.max(0, value.ratingDeviation ?? MAX_RATING_DEVIATION));
  return Math.max(0.1, 1 - (deviation / MAX_RATING_DEVIATION) ** 2);
};

export const rankAttributeSimilarity = (
  anchorValues: Array<AttributeMatrixValue | undefined>,
  candidates: Array<{ subjectId: string; values: Array<AttributeMatrixValue | undefined> }>,
) => {
  const anchorConfidence = anchorValues.reduce((total, value) => total + confidence(value), 0);
  if (anchorConfidence <= 0) return [];

  return candidates.flatMap<AttributeSimilarityMatch>((candidate) => {
    let sharedWeight = 0;
    let weightedSquaredDistance = 0;
    let sharedAttributeCount = 0;

    anchorValues.forEach((anchorValue, index) => {
      const candidateValue = candidate.values[index];
      const weight = Math.min(confidence(anchorValue), confidence(candidateValue));
      if (weight <= 0 || !anchorValue || !candidateValue) return;
      const difference = Math.abs(anchorValue.score - candidateValue.score) / 10;
      sharedWeight += weight;
      weightedSquaredDistance += weight * difference ** 2;
      sharedAttributeCount += 1;
    });

    if (sharedWeight <= 0) return [];
    const distance = Math.sqrt(weightedSquaredDistance / sharedWeight);
    const coverage = Math.min(1, sharedWeight / anchorConfidence);
    return [{
      subjectId: candidate.subjectId,
      distance,
      coverage,
      sharedAttributeCount,
      rankCost: distance + 0.35 * (1 - coverage) + 0.08 / Math.sqrt(sharedWeight),
    }];
  }).sort((left, right) => left.rankCost - right.rankCost || right.coverage - left.coverage || left.subjectId.localeCompare(right.subjectId));
};
