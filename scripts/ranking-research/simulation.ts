import { applyBallot, initial, slope, type Ballot, type Model, type State } from './models';

// Irregular gaps on a fixed 0–10 scale; six groups of four games.
const spread = [.3, .7, 1.2, 1.4, 2, 2.3, 2.6, 2.7, 3.4, 3.7, 4, 4.2,
  4.8, 5.1, 5.7, 5.8, 6.6, 6.9, 7.1, 7.7, 8.1, 8.5, 9.1, 9.7];
const highOnly = [6.1, 6.3, 6.4, 6.9, 7, 7.2, 7.5, 7.9, 8, 8.5, 9, 9.5];
export const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / values.length;
export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};

export type Scenario = 'wide-noisy' | 'near-noisy' | 'wide-gaussian' | 'wide-consistent' | 'high-island';
export const checkpoints = Array.from({ length: 17 }, (_, i) => i * 10);
export const seedCount = 64;

function randomSource(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}

export function makeFixture(scenario: Scenario, seed: number) {
  const random = randomSource(seed);
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const sample = (n: number) => Math.floor(n * random());
  const truth = scenario === 'high-island' ? highOnly : spread;
  const ids = truth.map((_, i) => i);
  const base = truth.map((value, i) => {
    const rd = [0.65, 1.5, 2.5][i % 3];
    const estimate = scenario === 'high-island' ? value - 2.5 : value;
    return initial(Math.max(0, Math.min(10, estimate + normal() * rd * 0.8)), rd);
  });
  if (scenario !== 'high-island') {
    // Two comparably wrong high/low games, with different starting confidence.
    base[5] = initial(7.5, 0.65);
    base[19] = initial(2.5, 2.5);
  }
  const refValues = [1.5, 8.5];
  base.push(...refValues.map(value => initial(value, 0.5)));
  // Independent stream: changing voter noise leaves selections, confirmations,
  // direction and roles identical across all three wide scenarios.
  const noiseRandom = randomSource(seed ^ 0x6d2b79f5);
  const noise = () => {
    const u = noiseRandom(), v = noiseRandom();
    if (scenario === 'wide-consistent' || scenario === 'wide-gaussian') {
      const sd = scenario === 'wide-consistent' ? 1.5 : Math.PI / (Math.sqrt(6) * slope);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd;
    }
    return -Math.log(-Math.log(u)) / slope;
  };
  const ballots: Ballot[] = [];
  for (let t = 0; t < checkpoints.at(-1)!; t++) {
    let chosen: number[];
    if (scenario === 'near-noisy') {
      const start = sample(truth.length - 5);
      chosen = ids.slice(start, start + 6);
    } else {
      const groupSize = truth.length / 6;
      chosen = Array.from({ length: 6 }, (_, i) => i * groupSize + sample(groupSize));
    }
    // Draw one perceived value per game per vote. Pair outcomes in the same
    // order share that perception. Omitted games are never ranked.
    const perceived = new Map(chosen.map(id => [id, truth[id] + noise()]));
    const order = [...chosen].sort((a, b) => perceived.get(b)! - perceived.get(a)!);
    const player = chosen[sample(chosen.length)];
    const refIndex = scenario === 'high-island' ? 1 : sample(2);
    const displayedScore = refValues[refIndex];
    const refPerception = displayedScore + noise();
    const lowPole = random() < 0.5;
    const roleDraw = random();
    ballots.push({ order: lowPole ? order.reverse() : order, lowPole,
      weight: roleDraw < 0.6 ? 1 : roleDraw < 0.9 ? 1.5 : 2,
      reference: { id: truth.length + refIndex, displayedScore, player,
        playerHigher: perceived.get(player)! > refPerception, confirmed: random() < 0.5 } });
  }
  return { base, truth, ballots };
}

export type Fixture = ReturnType<typeof makeFixture>;

function measure(states: State[], truth: number[]) {
  let wrong = 0, count = 0;
  for (let i = 0; i < truth.length; i++) for (let j = i + 1; j < truth.length; j++) {
    if (truth[j] - truth[i] < 1) continue;
    wrong += (1 - Math.sign(states[j].score - states[i].score)) / 2;
    count++;
  }
  const error = truth.map((value, i) => Math.abs(states[i].score - value));
  return { mae: mean(error), inversions: wrong / count, rd: mean(truth.map((_, i) => states[i].ratingDeviation)),
    plantedFixed: truth.length > 19 && states[5].score < states[19].score,
    coverage: mean(error.map((e, i) => Number(e <= 1.96 * states[i].ratingDeviation))) };
}

export function runSeries({ base, truth, ballots }: Fixture, model: Model) {
  const states = [...base];
  const curve = [measure(states, truth)];
  for (const [i, ballot] of ballots.entries()) {
    applyBallot(states, ballot, model);
    if (checkpoints.includes(i + 1)) curve.push(measure(states, truth));
  }
  // Lasting correction, counting non-completion explicitly. Need at least
  // three observed checkpoints including the first qualifying one.
  const first = curve.findIndex((_, i) => i <= curve.length - 3 && curve.slice(i).every(m => m.inversions <= .05));
  const reverse = [...base];
  for (const ballot of [...ballots].reverse()) applyBallot(reverse, ballot, model);
  return { curve, stableFrom: first < 0 ? Infinity : checkpoints[first],
    orderSensitivity: mean(truth.map((_, i) => Math.abs(states[i].score - reverse[i].score))),
    tightError: Math.abs(states[5].score - truth[5]),
    looseError: truth.length > 19 ? Math.abs(states[19].score - truth[19]) : null };
}
