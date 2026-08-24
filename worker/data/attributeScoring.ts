import type { AttributeComparisonResult, AttributeMatrixValue } from '../../src/shared/types';

export const ATTRIBUTE_SCORE_MODEL_VERSION = 'bounded-k-elo-v1';
export const ATTRIBUTE_INITIAL_SCORE = 5;
export const ATTRIBUTE_MIN_SCORE = 0;
export const ATTRIBUTE_MAX_SCORE = 10;

// These values are deliberately configuration, not magic numbers spread over
// the route. The 20-evidence point is the current product decision: after it,
// a single vote should only make a small correction.
export const ATTRIBUTE_K_SCHEDULE = [
  { throughEvidence: 4, value: 1 },
  { throughEvidence: 9, value: 0.6 },
  { throughEvidence: 14, value: 0.3 },
  { throughEvidence: 19, value: 0.12 },
  { throughEvidence: Number.POSITIVE_INFINITY, value: 0.05 },
] as const;

// κ-Elo's scale is expressed here in the user-facing 0–10 coordinate rather
// than the traditional 400-point chess scale. κ=2 gives an explicit draw
// outcome with a 50% draw probability when two ratings are equal.
export const ATTRIBUTE_ELO_SCALE = 3;
export const ATTRIBUTE_DRAW_KAPPA = 2;

export interface OnlineAttributeState {
  score: number;
  directSum: number;
  directCount: number;
  comparisonCount: number;
  decisiveComparisonCount: number;
  evidenceCount: number;
}

export interface AttributeRatingEvidence {
  subjectId: string;
  attributeId: string;
  average: number;
  count: number;
}

export interface AttributeComparisonEvidence {
  subjectAId: string;
  subjectBId: string;
  attributeId: string;
  result: AttributeComparisonResult;
}

export interface AttributeUpdateResult {
  next: OnlineAttributeState;
  delta: number;
}

const boundedScore = (value: number) => Math.min(ATTRIBUTE_MAX_SCORE, Math.max(ATTRIBUTE_MIN_SCORE, value));

export const kFactorForEvidenceCount = (evidenceCount: number) => {
  const schedule = ATTRIBUTE_K_SCHEDULE.find((entry) => evidenceCount <= entry.throughEvidence);
  return schedule?.value ?? ATTRIBUTE_K_SCHEDULE.at(-1)!.value;
};

export const emptyAttributeState = (): OnlineAttributeState => ({
  score: ATTRIBUTE_INITIAL_SCORE,
  directSum: 0,
  directCount: 0,
  comparisonCount: 0,
  decisiveComparisonCount: 0,
  evidenceCount: 0,
});

const ratioForDifference = (difference: number) => 10 ** (difference / (2 * ATTRIBUTE_ELO_SCALE));

/** Expected Elo score for A, including the explicit draw outcome. */
export const expectedAttributeScore = (scoreA: number, scoreB: number) => {
  const ratio = ratioForDifference(scoreA - scoreB);
  const inverse = 1 / ratio;
  const denominator = ratio + inverse + ATTRIBUTE_DRAW_KAPPA;
  const winProbability = ratio / denominator;
  const drawProbability = ATTRIBUTE_DRAW_KAPPA / denominator;
  return winProbability + (drawProbability / 2);
};

const actualScoreForComparison = (result: AttributeComparisonResult): number => {
  if (result === 'A_HIGHER') return 1;
  if (result === 'B_HIGHER') return 0;
  return 0.5;
};

const updateState = (state: OnlineAttributeState, delta: number, kind: 'rating' | 'comparison', result?: AttributeComparisonResult): AttributeUpdateResult => {
  const next: OnlineAttributeState = {
    ...state,
    score: boundedScore(state.score + delta),
    comparisonCount: state.comparisonCount + (kind === 'comparison' ? 1 : 0),
    decisiveComparisonCount: state.decisiveComparisonCount + (kind === 'comparison' && result !== 'SIMILAR' ? 1 : 0),
    evidenceCount: state.evidenceCount + 1,
  };
  return { next, delta: next.score - state.score };
};

/**
 * A direct score is an observation that the subject is tied with a fixed
 * numeric anchor. The first real observation initializes a previously unseen
 * subject directly; later scores use the same draw update as every other
 * relationship.
 */
export const applyDirectRating = (state: OnlineAttributeState, value: number): AttributeUpdateResult => {
  const directSum = state.directSum + value;
  const directCount = state.directCount + 1;
  if (state.evidenceCount === 0) {
    const next = {
      ...state,
      score: boundedScore(value),
      directSum,
      directCount,
      evidenceCount: 1,
    };
    return { next, delta: next.score - state.score };
  }

  const expected = expectedAttributeScore(state.score, value);
  const delta = kFactorForEvidenceCount(state.evidenceCount) * (0.5 - expected);
  const updated = updateState(state, delta, 'rating');
  return { next: { ...updated.next, directSum, directCount }, delta: updated.delta };
};

/** Apply A wins, A loses, or A and B draw to two local states. */
export const applyComparison = (
  stateA: OnlineAttributeState,
  stateB: OnlineAttributeState,
  result: AttributeComparisonResult,
): { a: AttributeUpdateResult; b: AttributeUpdateResult } => {
  const expectedA = expectedAttributeScore(stateA.score, stateB.score);
  const actualA = actualScoreForComparison(result);
  const deltaA = kFactorForEvidenceCount(stateA.evidenceCount) * (actualA - expectedA);
  const deltaB = kFactorForEvidenceCount(stateB.evidenceCount) * ((1 - actualA) - (1 - expectedA));
  return {
    a: updateState(stateA, deltaA, 'comparison', result),
    b: updateState(stateB, deltaB, 'comparison', result),
  };
};

const scoreFromState = (subjectId: string, attributeId: string, state: OnlineAttributeState): AttributeMatrixValue => ({
  subjectId,
  attributeId,
  score: Number(state.score.toFixed(2)),
  directAverage: state.directCount ? Number((state.directSum / state.directCount).toFixed(2)) : undefined,
  directCount: state.directCount,
  comparisonCount: state.comparisonCount,
  decisiveComparisonCount: state.decisiveComparisonCount,
  evidenceCount: state.evidenceCount,
  kFactor: kFactorForEvidenceCount(state.evidenceCount),
  modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
});

/**
 * Deterministic helper for tests, imports, and one-off state checks. Runtime
 * writes use the same operations against the materialized D1 state instead of
 * replaying this entire collection.
 */
export const calculateAttributeScores = (
  ratings: AttributeRatingEvidence[],
  comparisons: AttributeComparisonEvidence[],
): AttributeMatrixValue[] => {
  const states = new Map<string, OnlineAttributeState>();
  const getState = (subjectId: string, attributeId: string) => {
    const key = `${subjectId}\u0000${attributeId}`;
    const existing = states.get(key);
    if (existing) return { key, state: existing };
    const created = emptyAttributeState();
    states.set(key, created);
    return { key, state: created };
  };

  ratings.forEach((rating) => {
    const { key, state } = getState(rating.subjectId, rating.attributeId);
    const initialized: OnlineAttributeState = {
      ...state,
      score: boundedScore(rating.average),
      directSum: rating.average * rating.count,
      directCount: rating.count,
      evidenceCount: rating.count,
    };
    states.set(key, initialized);
  });

  comparisons.forEach((comparison) => {
    const a = getState(comparison.subjectAId, comparison.attributeId);
    const b = getState(comparison.subjectBId, comparison.attributeId);
    const updated = applyComparison(a.state, b.state, comparison.result);
    states.set(a.key, updated.a.next);
    states.set(b.key, updated.b.next);
  });

  return [...states.entries()].map(([key, state]) => {
    const separator = key.indexOf('\u0000');
    return scoreFromState(key.slice(0, separator), key.slice(separator + 1), state);
  });
};
