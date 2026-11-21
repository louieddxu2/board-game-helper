import { ATTRIBUTE_CLASSIC_POINTS_PER_SCORE, ATTRIBUTE_GLICKO_Q, ATTRIBUTE_MAX_SCORE,
  ATTRIBUTE_MIN_RD, ATTRIBUTE_MIN_SCORE, type OnlineAttributeState } from './attributeScoring';

// The lower triangle of the ballot precision has entries u[i] · v[j]
// (i > j). Each direction of the ranking contributes one generator.
interface RankPrecision {
  diagonal: Float64Array;
  gradient: Float64Array;
  u: Float64Array;
  v: Float64Array;
}

function addDirection(scores: readonly OnlineAttributeState[], precision: RankPrecision, beta: number, weight: number, reverse: boolean) {
  const n = scores.length;
  const index = (position: number) => reverse ? n - 1 - position : position;
  const slope = reverse ? -beta : beta;
  const curvature = weight * beta ** 2;
  const worth = scores.map(({ score }) => Math.exp(slope * score));
  const suffix = new Float64Array(n + 1);
  for (let j = n - 1; j >= 0; j--) suffix[j] = suffix[j + 1] + worth[index(j)];

  let sum = 0, sumSquared = 0;
  for (let j = 0; j < n; j++) {
    if (j < n - 1) {
      const reciprocal = 1 / suffix[j];
      sum += reciprocal;
      sumSquared += reciprocal ** 2;
    }
    const i = index(j), a = worth[i];
    precision.gradient[i] += weight * slope * (Number(j < n - 1) - a * sum);
    precision.diagonal[i] += curvature * a * (sum - a * sumSquared);
    if (reverse) {
      precision.u[2 * i + 1] = -curvature * a * sumSquared;
      precision.v[2 * i + 1] = a;
    } else {
      precision.u[2 * i] = a;
      precision.v[2 * i] = -curvature * a * sumSquared;
    }
  }
}

// LDLᵀ factorization of the positive-definite precision. The lower
// triangular factor retains the same u and replaces each v with w.
// Only two prefix sums and a symmetric 2×2 matrix are needed.
function solveRankingPrecision({ diagonal, gradient, u, v }: RankPrecision) {
  const n = diagonal.length;
  const steps = new Float64Array(n);
  const variances = new Float64Array(n);
  let m00 = 0, m01 = 0, m11 = 0, z0 = 0, z1 = 0;
  for (let i = 0; i < n; i++) {
    const j = 2 * i, u0 = u[j], u1 = u[j + 1];
    const p0 = m00 * u0 + m01 * u1, p1 = m01 * u0 + m11 * u1;
    const pivot = diagonal[i] - u0 * p0 - u1 * p1;
    if (!(pivot > 0) || !Number.isFinite(pivot)) throw new Error('invalid_attribute_ranking_precision');
    const w0 = (v[j] - p0) / pivot, w1 = (v[j + 1] - p1) / pivot;
    v[j] = w0;
    v[j + 1] = w1;
    m00 += pivot * w0 * w0;
    m01 += pivot * w0 * w1;
    m11 += pivot * w1 * w1;
    // Forward substitution in L, followed by division by D.
    const z = gradient[i] - u0 * z0 - u1 * z1;
    z0 += w0 * z;
    z1 += w1 * z;
    steps[i] = z / pivot;
    variances[i] = 1 / pivot;
  }

  // Back substitution in Lᵀ. Propagate the covariance of the two running
  // sums with the same recurrence to obtain the inverse diagonal.
  let x0 = 0, x1 = 0, c00 = 0, c01 = 0, c11 = 0;
  for (let i = n - 1; i >= 0; i--) {
    const j = 2 * i, u0 = u[j], u1 = u[j + 1], w0 = v[j], w1 = v[j + 1];
    const cw0 = c00 * w0 + c01 * w1, cw1 = c01 * w0 + c11 * w1;
    const variance = variances[i] + w0 * cw0 + w1 * cw1;
    const step = steps[i] - w0 * x0 - w1 * x1;
    if (!(variance > 0) || !Number.isFinite(variance) || !Number.isFinite(step)) {
      throw new Error('invalid_attribute_ranking_precision');
    }
    c00 += u0 * (u0 * variance - 2 * cw0);
    c01 += u0 * u1 * variance - u0 * cw1 - u1 * cw0;
    c11 += u1 * (u1 * variance - 2 * cw1);
    x0 += u0 * step;
    x1 += u1 * step;
    steps[i] = step;
    variances[i] = variance;
  }
  return { steps, variances };
}

/** One joint update of a full ballot, in canonical high-to-low order. */
export function applyAttributeRanking(states: readonly OnlineAttributeState[], weight: number): OnlineAttributeState[] {
  const n = states.length;
  if (n < 2) return [...states];
  const precision: RankPrecision = {
    diagonal: Float64Array.from(states, ({ ratingDeviation }) => 1 / ratingDeviation ** 2),
    gradient: new Float64Array(n),
    u: new Float64Array(2 * n),
    v: new Float64Array(2 * n),
  };
  const harmonic = states.reduce((sum, _, i) => sum + 1 / (i + 1), 0);
  const beta = ATTRIBUTE_GLICKO_Q * ATTRIBUTE_CLASSIC_POINTS_PER_SCORE;
  // Use twice the equal-score information of n−1 ordinary comparisons,
  // shared equally between the two directions of the same original ballot.
  const directionWeight = weight * (n - 1) / (2 * (n - harmonic));
  addDirection(states, precision, beta, directionWeight, false);
  addDirection(states, precision, beta, directionWeight, true);
  const { steps, variances } = solveRankingPrecision(precision);
  return states.map((state, i) => {
    const step = steps[i];
    const room = step > 0 ? ATTRIBUTE_MAX_SCORE - state.score : state.score - ATTRIBUTE_MIN_SCORE;
    const delta = room > 0 ? Math.sign(step) * room * -Math.expm1(-Math.abs(step) / room) : 0;
    const comparisons = i === 0 || i === n - 1 ? 1 : 2;
    return {
      ...state,
      score: Math.min(ATTRIBUTE_MAX_SCORE, Math.max(ATTRIBUTE_MIN_SCORE, state.score + delta)),
      ratingDeviation: Math.max(ATTRIBUTE_MIN_RD, Math.sqrt(variances[i])),
      comparisonCount: state.comparisonCount + comparisons,
      decisiveComparisonCount: state.decisiveComparisonCount + comparisons,
      evidenceCount: state.evidenceCount + comparisons,
    };
  });
}
