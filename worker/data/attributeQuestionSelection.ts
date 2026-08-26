import { expectedComparisonVarianceReduction } from './attributeScoring';

export const ATTRIBUTE_QUESTION_EXPLORATION_RATE = 0.2;

export interface AttributeQuestionSelectionState {
  subjectId: string;
  score: number;
  ratingDeviation: number;
}

export interface AttributeQuestionOpponentCandidate extends AttributeQuestionSelectionState {
  comparisonCount: number;
  isRandomCandidate: boolean;
}

export const attributeQuestionCandidateWeight = (
  seed: AttributeQuestionSelectionState,
  candidate: AttributeQuestionOpponentCandidate,
) => expectedComparisonVarianceReduction(
  seed.score,
  seed.ratingDeviation,
  candidate.score,
  candidate.ratingDeviation,
) / Math.sqrt(1 + Math.max(0, candidate.comparisonCount));

const weightedChoice = (
  seed: AttributeQuestionSelectionState,
  candidates: AttributeQuestionOpponentCandidate[],
  randomValue: number,
) => {
  const weighted = candidates.map((candidate) => ({
    candidate,
    weight: Math.max(Number.EPSILON, attributeQuestionCandidateWeight(seed, candidate)),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.min(1 - Number.EPSILON, Math.max(0, randomValue)) * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.candidate;
  }
  return weighted.at(-1)?.candidate ?? null;
};

export const chooseAttributeQuestionOpponent = (
  seed: AttributeQuestionSelectionState,
  candidates: AttributeQuestionOpponentCandidate[],
  explorationRoll = Math.random(),
  selectionRoll = Math.random(),
) => {
  if (!candidates.length) return null;
  const randomCandidates = candidates.filter((candidate) => candidate.isRandomCandidate);
  const pool = explorationRoll < ATTRIBUTE_QUESTION_EXPLORATION_RATE && randomCandidates.length
    ? randomCandidates
    : candidates;
  return weightedChoice(seed, pool, selectionRoll);
};
