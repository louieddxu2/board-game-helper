import { addRankEvidence, priorPrecision, slope, updateRankedStates, type Ballot, type State } from './models';

export const methods = ['forward', 'bidirectional', 'all-pairs', 'downweight-close'] as const;
export type Method = typeof methods[number];
export type Candidate = { method: Method; slopeFactor: number; softBounds: boolean; evidenceScale?: number };

// A composite objective for one ballot. Its pair weights add up to n-1 at
// the base slope. All terms use the same pre-ballot state and one joint update.
function addPairEvidence(scores: number[], gradient: Float64Array, precision: Float64Array[],
  beta: number, ballotBudget: number, downweightClose: boolean) {
  let totalWeight = 0;
  const comparisons = [];
  for (let high = 0; high < scores.length; high++) {
    for (let low = high + 1; low < scores.length; low++) {
      const gap = scores[high] - scores[low];
      // The method sees its own pre-vote estimate; fixture truth is unavailable.
      const weight = downweightClose ? .35 + .65 * Math.min(1, Math.abs(gap) / 3) : 1;
      comparisons.push({ high, low, gap, weight });
      totalWeight += weight;
    }
  }
  for (const edge of comparisons) {
    const w = ballotBudget * edge.weight / totalWeight;
    const p = 1 / (1 + Math.exp(-beta * edge.gap));
    const step = w * beta * (1 - p);
    const info = w * beta ** 2 * p * (1 - p);
    gradient[edge.high] += step;
    gradient[edge.low] -= step;
    precision[edge.high][edge.high] += info;
    precision[edge.low][edge.low] += info;
    precision[edge.high][edge.low] -= info;
    precision[edge.low][edge.high] -= info;
  }
}

export function applyCandidate(states: State[], ballot: Ballot, candidate: Candidate) {
  const ids = ballot.lowPole ? [...ballot.order].reverse() : ballot.order;
  const scores = ids.map(id => states[id].score);
  const n = ids.length;
  const gradient = new Float64Array(n);
  const precision = priorPrecision(states, ids);
  const beta = slope * candidate.slopeFactor;
  const budget = ballot.weight * (n - 1) * (candidate.evidenceScale ?? 1) / candidate.slopeFactor ** 2;
  if (candidate.method === 'all-pairs' || candidate.method === 'downweight-close') {
    addPairEvidence(scores, gradient, precision, beta, budget, candidate.method === 'downweight-close');
  } else {
    const harmonic = scores.reduce((sum, _, i) => sum + 1 / (i + 1), 0);
    const weight = budget / (2 * (n - harmonic));
    if (candidate.method === 'bidirectional') {
      addRankEvidence(scores, gradient, precision, beta, weight / 2);
      addRankEvidence(scores, gradient, precision, beta, weight / 2, true);
    } else {
      addRankEvidence(scores, gradient, precision, beta, weight);
    }
  }
  updateRankedStates(states, ids, gradient, precision, candidate.softBounds);
}
