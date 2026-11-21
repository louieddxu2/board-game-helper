import assert from 'node:assert/strict';
import { rankingComparisons } from '../../src/shared/attributeRankingBallot';
import { applyComparison, ATTRIBUTE_CLASSIC_POINTS_PER_SCORE, ATTRIBUTE_GLICKO_Q,
  ATTRIBUTE_MIN_RD, emptyAttributeState } from '../../worker/data/attributeScoring';

export const slope = ATTRIBUTE_GLICKO_Q * ATTRIBUTE_CLASSIC_POINTS_PER_SCORE;
export type State = ReturnType<typeof emptyAttributeState>;
export type Model = 'adjacent' | 'list' | 'steeper-list' | 'one-pair-budget' | 'anchor' | 'blind-control';
export type Ballot = {
  // Numeric fixture IDs stand for subjects. Order is in the displayed direction.
  order: number[];
  lowPole: boolean;
  weight: number;
  reference?: {
    player: number;
    id: number;
    displayedScore: number; // Canonical scale, before display-direction conversion.
    playerHigher: boolean; // Relative to the canonical high end.
    confirmed: boolean;
  };
};

export const initial = (score = 5, ratingDeviation = 3): State => ({
  ...emptyAttributeState(), score, ratingDeviation,
});

function applyAdjacent(states: State[], ballot: Ballot) {
  const pairs = rankingComparisons({
    version: 1, orderedSubjectIds: ballot.order.map(String), referenceSubjectIds: [],
  }, ballot.lowPole ? 'low' : 'high');
  for (const pair of pairs) {
    const a = Number(pair.subjectAId), b = Number(pair.subjectBId);
    const next = applyComparison(states[a], states[b], pair.comparison, ballot.weight);
    states[a] = next.a.next;
    states[b] = next.b.next;
  }
}

const identity = (size: number) => Array.from({ length: size }, (_, i) =>
  Float64Array.from({ length: size }, (_, j) => Number(i === j)));

// Invert the within-ballot posterior precision. The diagonal Gaussian prior
// makes it positive definite. We retain marginal variances, not 1/H_ii.
function covariance(precision: Float64Array[]) {
  const size = precision.length;
  const result = identity(size);
  for (let i = 0; i < size; i++) {
    const pivot = precision[i][i];
    assert(pivot > 0 && Number.isFinite(pivot));
    for (let j = 0; j < size; j++) {
      precision[i][j] /= pivot;
      result[i][j] /= pivot;
    }
    for (let row = 0; row < size; row++) {
      if (row === i) continue;
      const factor = precision[row][i];
      for (let j = 0; j < size; j++) {
        precision[row][j] -= factor * precision[i][j];
        result[row][j] -= factor * result[i][j];
      }
    }
  }
  return result;
}

export function priorPrecision(states: State[], ids: number[]) {
  const precision = identity(ids.length);
  ids.forEach((id, i) => { precision[i][i] = 1 / states[id].ratingDeviation ** 2; });
  return precision;
}

export function addRankEvidence(scores: number[], gradient: Float64Array, precision: Float64Array[],
  beta: number, weight: number, bottomFirst = false) {
  const n = scores.length;
  const direction = bottomFirst ? -beta : beta;
  const order = scores.map((_, i) => bottomFirst ? n - 1 - i : i);
  const worth = scores.map(score => Math.exp(direction * score));
  for (let first = 0; first < n - 1; first++) {
    let total = 0;
    for (let j = first; j < n; j++) total += worth[order[j]];
    gradient[order[first]] += weight * direction;
    for (let j = first; j < n; j++) {
      const row = order[j];
      const probability = worth[row] / total;
      gradient[row] -= weight * direction * probability;
      const curvature = weight * direction ** 2 * probability;
      precision[row][row] += curvature;
      for (let k = first; k < n; k++) precision[row][order[k]] -= curvature * worth[order[k]] / total;
    }
  }
}

export function updateRankedStates(states: State[], ids: number[], gradient: Float64Array,
  precision: Float64Array[], softBounds = false) {
  const cov = covariance(precision);
  ids.forEach((id, i) => {
    let delta = cov[i].reduce((sum, cell, j) => sum + cell * gradient[j], 0);
    const previous = states[id].score;
    if (softBounds) {
      const room = delta > 0 ? 10 - previous : previous;
      delta = room === 0 ? 0 : Math.sign(delta) * room * -Math.expm1(-Math.abs(delta) / room);
    }
    states[id] = { ...states[id], score: Math.max(0, Math.min(10, previous + delta)),
      ratingDeviation: Math.max(ATTRIBUTE_MIN_RD, Math.sqrt(cov[i][i])) };
  });
}

// One local Gaussian update of the weighted rank likelihood at the prior
// means. Cross-game covariance is used inside this ballot only.
export function applyBallot(states: State[], ballot: Ballot, model: Model, replayReference = false) {
  if (model === 'adjacent') return applyAdjacent(states, ballot);
  const ids = ballot.lowPole ? [...ballot.order].reverse() : ballot.order;
  const n = ids.length;
  const rankSlope = model === 'steeper-list' ? 2 * slope : slope;
  const gradient = new Float64Array(n);
  const precision = priorPrecision(states, ids);

  const ref = ballot.reference;
  const useRef = ref && (model === 'anchor' && ref.confirmed || model === 'blind-control');
  // In units of the trace of one equally matched logistic pair. Reserve
  // half a unit for one confirmed relation, inside the same ballot budget.
  const budget = model === 'one-pair-budget' ? 1 : n - 1;
  const anchorUnits = useRef ? 0.5 : 0;
  const harmonicSum = ids.reduce((sum, _, i) => sum + 1 / (i + 1), 0);
  const rankWeight = ballot.weight * (budget - anchorUnits) / (2 * (n - harmonicSum)) * (slope / rankSlope) ** 2;

  addRankEvidence(ids.map(id => states[id].score), gradient, precision, rankSlope, rankWeight);
  if (useRef) {
    const index = ids.indexOf(ref.player);
    assert(index >= 0 && !ids.includes(ref.id));
    const value = replayReference ? states[ref.id].score : ref.displayedScore;
    const p = 1 / (1 + Math.exp(-slope * (states[ref.player].score - value)));
    // Negative control: an unfamiliar player appends below the prefilled
    // examples in the displayed direction. Only the deliberate bad arm uses it.
    const higher = ref.confirmed ? ref.playerHigher : ballot.lowPole;
    gradient[index] += ballot.weight * anchorUnits * slope * (Number(higher) - p);
    precision[index][index] += ballot.weight * anchorUnits * slope ** 2 * p * (1 - p);
  }
  updateRankedStates(states, ids, gradient, precision);
}
