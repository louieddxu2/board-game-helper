import type { AttributeComparisonResult, AttributeMatrixValue } from '../../src/shared/types';

/**
 * Glicko-1's rating/deviation update, expressed on the product's 0-10 scale.
 * The classic Glicko equations use a 400 point scale, so one product point is
 * represented by 40 classic points. Volatility is intentionally not part of
 * this model: RD is the only uncertainty state we persist.
 */
export const ATTRIBUTE_SCORE_MODEL_VERSION = 'glicko-rd-v1';
export const ATTRIBUTE_INITIAL_SCORE = 5;
export const ATTRIBUTE_MIN_SCORE = 0;
export const ATTRIBUTE_MAX_SCORE = 10;
export const ATTRIBUTE_INITIAL_RD = 3;
export const ATTRIBUTE_DIRECT_RATING_RD = ATTRIBUTE_INITIAL_RD / 2;
export const ATTRIBUTE_MIN_RD = 0.25;
export const ATTRIBUTE_MAX_RD = ATTRIBUTE_INITIAL_RD;
export const ATTRIBUTE_CLASSIC_POINTS_PER_SCORE = 40;
export const ATTRIBUTE_GLICKO_Q = Math.log(10) / 400;

export interface OnlineAttributeState {
  score: number;
  ratingDeviation: number;
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

export interface AttributeVoteReplayEvent {
  id: string;
  createdAt: number;
  kind: 'rating' | 'comparison';
  attributeId: string;
  subjectAId: string;
  subjectBId?: string | null;
  value?: number | null;
  result?: AttributeComparisonResult | null;
}

export interface AttributeResponseReplayRecord {
  responseId: string;
  createdAt: number;
  attributeId: string;
  subjectAId: string | null;
  subjectBId: string | null;
  ratingA: number | null;
  ratingB: number | null;
  comparison: AttributeComparisonResult | null;
}

export interface AttributeUpdateResult {
  next: OnlineAttributeState;
  delta: number;
}

const boundedScore = (value: number) => Math.min(ATTRIBUTE_MAX_SCORE, Math.max(ATTRIBUTE_MIN_SCORE, value));
const boundedRd = (value: number) => Math.min(ATTRIBUTE_MAX_RD, Math.max(ATTRIBUTE_MIN_RD, value));
const classicRating = (score: number) => score * ATTRIBUTE_CLASSIC_POINTS_PER_SCORE;
const classicRd = (ratingDeviation: number) => ratingDeviation * ATTRIBUTE_CLASSIC_POINTS_PER_SCORE;

const gForRd = (ratingDeviation: number) => {
  const rd = classicRd(ratingDeviation);
  return 1 / Math.sqrt(1 + (3 * ATTRIBUTE_GLICKO_Q ** 2 * rd ** 2) / Math.PI ** 2);
};

const expectedForRatings = (score: number, opponentScore: number, opponentRd: number) => {
  const g = gForRd(opponentRd);
  const difference = g * (classicRating(score) - classicRating(opponentScore));
  return 1 / (1 + 10 ** (-difference / 400));
};

const expectedRdAfterComparison = (
  score: number,
  ratingDeviation: number,
  opponentScore: number,
  opponentRatingDeviation: number,
) => {
  const g = gForRd(opponentRatingDeviation);
  const expected = expectedForRatings(score, opponentScore, opponentRatingDeviation);
  const variance = 1 / (ATTRIBUTE_GLICKO_Q ** 2 * g ** 2 * expected * (1 - expected));
  const currentRd = classicRd(ratingDeviation);
  return boundedRd(Math.sqrt(1 / (1 / currentRd ** 2 + 1 / variance)) / ATTRIBUTE_CLASSIC_POINTS_PER_SCORE);
};

const updateAgainst = (
  state: OnlineAttributeState,
  opponent: Pick<OnlineAttributeState, 'score' | 'ratingDeviation'>,
  actualScore: number,
  kind: 'rating' | 'comparison',
  result?: AttributeComparisonResult,
): AttributeUpdateResult => {
  const g = gForRd(opponent.ratingDeviation);
  const expected = expectedForRatings(state.score, opponent.score, opponent.ratingDeviation);
  const variance = 1 / (ATTRIBUTE_GLICKO_Q ** 2 * g ** 2 * expected * (1 - expected));
  const currentRd = classicRd(state.ratingDeviation);
  const updatedClassicRd = Math.sqrt(1 / (1 / currentRd ** 2 + 1 / variance));
  const updateFactor = ATTRIBUTE_GLICKO_Q / (1 / currentRd ** 2 + 1 / variance);
  const updatedClassicRating = classicRating(state.score) + updateFactor * g * (actualScore - expected);
  const next: OnlineAttributeState = {
    ...state,
    score: boundedScore(updatedClassicRating / ATTRIBUTE_CLASSIC_POINTS_PER_SCORE),
    ratingDeviation: boundedRd(updatedClassicRd / ATTRIBUTE_CLASSIC_POINTS_PER_SCORE),
    comparisonCount: state.comparisonCount + (kind === 'comparison' ? 1 : 0),
    decisiveComparisonCount: state.decisiveComparisonCount + (kind === 'comparison' && result !== 'SIMILAR' ? 1 : 0),
    evidenceCount: state.evidenceCount + 1,
  };
  return { next, delta: next.score - state.score };
};

export const emptyAttributeState = (): OnlineAttributeState => ({
  score: ATTRIBUTE_INITIAL_SCORE,
  ratingDeviation: ATTRIBUTE_INITIAL_RD,
  directSum: 0,
  directCount: 0,
  comparisonCount: 0,
  decisiveComparisonCount: 0,
  evidenceCount: 0,
});

/** The expected win probability for A against B under Glicko's g(RD) term. */
export const expectedAttributeScore = (scoreA: number, scoreB: number, ratingDeviationB = ATTRIBUTE_INITIAL_RD) =>
  expectedForRatings(scoreA, scoreB, ratingDeviationB);

/**
 * Expected reduction in the pair's total rating variance after one comparison.
 * Glicko's RD update does not depend on who wins, so this is known before the
 * question is answered and can be used directly as an information-gain score.
 */
export const expectedComparisonVarianceReduction = (
  scoreA: number,
  ratingDeviationA: number,
  scoreB: number,
  ratingDeviationB: number,
) => {
  const nextRdA = expectedRdAfterComparison(scoreA, ratingDeviationA, scoreB, ratingDeviationB);
  const nextRdB = expectedRdAfterComparison(scoreB, ratingDeviationB, scoreA, ratingDeviationA);
  return Math.max(0,
    ratingDeviationA ** 2 + ratingDeviationB ** 2
      - nextRdA ** 2 - nextRdB ** 2);
};

const actualScoreForComparison = (result: AttributeComparisonResult): number => {
  if (result === 'A_HIGHER') return 1;
  if (result === 'B_HIGHER') return 0;
  return 0.5;
};

/**
 * A direct number is a draw against a temporary numeric opponent. The
 * opponent's default RD is tighter than an unscored subject, so an anchor at
 * 8 influences a high-RD subject more than a well-established subject.
 */
export const applyDirectRating = (state: OnlineAttributeState, value: number): AttributeUpdateResult => {
  const boundedValue = boundedScore(value);
  const directSum = state.directSum + boundedValue;
  const directCount = state.directCount + 1;
  if (state.evidenceCount === 0) {
    const next: OnlineAttributeState = {
      ...state,
      score: boundedValue,
      ratingDeviation: ATTRIBUTE_DIRECT_RATING_RD,
      directSum,
      directCount,
      evidenceCount: 1,
    };
    return { next, delta: next.score - state.score };
  }

  const updated = updateAgainst(
    state,
    { score: boundedValue, ratingDeviation: ATTRIBUTE_DIRECT_RATING_RD },
    0.5,
    'rating',
  );
  return { next: { ...updated.next, directSum, directCount }, delta: updated.delta };
};

/** Apply A wins, A loses, or A and B draw to two local states. */
export const applyComparison = (
  stateA: OnlineAttributeState,
  stateB: OnlineAttributeState,
  result: AttributeComparisonResult,
): { a: AttributeUpdateResult; b: AttributeUpdateResult } => {
  const actualA = actualScoreForComparison(result);
  return {
    a: updateAgainst(stateA, stateB, actualA, 'comparison', result),
    b: updateAgainst(stateB, stateA, 1 - actualA, 'comparison', result),
  };
};

const scoreFromState = (subjectId: string, attributeId: string, state: OnlineAttributeState): AttributeMatrixValue => ({
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

/** Deterministic helper used by tests, imports, and one-off state checks. */
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
    const next: OnlineAttributeState = {
      ...state,
      score: boundedScore(rating.average),
      ratingDeviation: boundedRd(ATTRIBUTE_DIRECT_RATING_RD / Math.sqrt(Math.max(1, rating.count))),
      directSum: rating.average * rating.count,
      directCount: rating.count,
      evidenceCount: rating.count,
    };
    states.set(key, next);
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

/**
 * One-time migration helper: replay the append-only stream in a fixed
 * created_at/id order. Runtime requests use materialized rows instead, so
 * this intentionally does not belong in the voting hot path.
 */
export const replayAttributeEvents = (events: AttributeVoteReplayEvent[]) => {
  const states = new Map<string, OnlineAttributeState>();
  const getState = (subjectId: string, attributeId: string) => {
    const key = `${subjectId}\u0000${attributeId}`;
    const state = states.get(key) ?? emptyAttributeState();
    states.set(key, state);
    return { key, state };
  };
  [...events]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .forEach((event) => {
      const a = getState(event.subjectAId, event.attributeId);
      if (event.kind === 'rating' && event.value != null) {
        states.set(a.key, applyDirectRating(a.state, event.value).next);
        return;
      }
      if (event.kind === 'comparison' && event.subjectBId && event.result) {
        const b = getState(event.subjectBId, event.attributeId);
        const updated = applyComparison(a.state, b.state, event.result);
        states.set(a.key, updated.a.next);
        states.set(b.key, updated.b.next);
      }
    });
  return states;
};

/**
 * Rebuild materialized states from the compact answer stream. A response is
 * replayed in the same order as the online write path: A's direct score, B's
 * direct score, then the comparison. The optional subject mapper is used by
 * game merges to fold the old subject into the canonical subject without
 * rewriting the append-only history rows.
 */
export const replayAttributeResponses = (
  responses: AttributeResponseReplayRecord[],
  subjectMapper: (subjectId: string) => string = (subjectId) => subjectId,
) => {
  const states = new Map<string, OnlineAttributeState>();
  const getState = (subjectId: string, attributeId: string) => {
    const key = `${subjectId}\u0000${attributeId}`;
    const state = states.get(key) ?? emptyAttributeState();
    states.set(key, state);
    return { key, state };
  };

  [...responses]
    .sort((left, right) => left.createdAt - right.createdAt || left.responseId.localeCompare(right.responseId))
    .forEach((response) => {
      const subjectAId = response.subjectAId ? subjectMapper(response.subjectAId) : null;
      const subjectBId = response.subjectBId ? subjectMapper(response.subjectBId) : null;
      if (subjectAId && response.ratingA != null) {
        const a = getState(subjectAId, response.attributeId);
        states.set(a.key, applyDirectRating(a.state, response.ratingA).next);
      }
      if (subjectBId && response.ratingB != null) {
        const b = getState(subjectBId, response.attributeId);
        states.set(b.key, applyDirectRating(b.state, response.ratingB).next);
      }
      if (subjectAId && subjectBId && subjectAId !== subjectBId && response.comparison != null) {
        const a = getState(subjectAId, response.attributeId);
        const b = getState(subjectBId, response.attributeId);
        const updated = applyComparison(a.state, b.state, response.comparison);
        states.set(a.key, updated.a.next);
        states.set(b.key, updated.b.next);
      }
    });

  return states;
};
