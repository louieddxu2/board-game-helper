import assert from 'node:assert/strict';
import { applyBallot, initial, type Ballot, type State } from './ranking-research/models';
import { correct, drawBallot, neighbors, pairs, swapped, truth } from './ranking-research/order-fixture';
import { applyCandidate, methods, type Candidate } from './ranking-research/order-candidates';
import { mean, median, randomSource } from './ranking-research/simulation';

const trainSeeds = 24, testSeeds = 100, horizon = 500;
type Start = 'swapped' | 'cold' | 'perturbed' | 'neighbor-swaps';
type Noise = 2 | 5 | 'mixed-tastes';
type Strategy = 'adjacent' | 'list' | Candidate;
const pct = (fraction: number) => Number((100 * fraction).toFixed(2));
const print = (event: string, values: object) => console.log(JSON.stringify({ event, ...values }));
const flippedNeighbors = neighbors.filter(([low]) => truth[low] === 4 || truth[low] === 6);

function fixture(seed: number, start: Start, noise: Noise) {
  const random = randomSource(seed), setup = randomSource(seed ^ 0x6c8e9cf5);
  const base = truth.map((value, i) => {
    if (start === 'cold') return initial();
    if (start === 'swapped') return initial(value === 2 ? 8 : value === 8 ? 2 : value, 1.5);
    if (start === 'neighbor-swaps') {
      const reversedLevels = [0, 1, 2, 3, 5, 4, 7, 6, 8, 9, 10];
      return initial(reversedLevels[value], 1.5);
    }
    return initial(Math.max(0, Math.min(10, value + 8 * (setup() - .5))), [.65, 1.5, 2.5][i % 3]);
  });
  // In the mixed-taste scenario, two equally probable voter groups have
  // opposite persistent game-specific preferences, in addition to per-vote noise.
  const tasteA = truth.map(() => setup() < .5 ? -1 : 1);
  const tasteB = tasteA.map(v => -v);
  const ballots = Array.from({ length: horizon + 80 }, () => {
    if (noise !== 'mixed-tastes') return drawBallot(random, noise);
    return drawBallot(random, random() < .5 ? 2 : 5, random() < .5 ? tasteA : tasteB);
  });
  return { base, ballots };
}
type Fixture = ReturnType<typeof fixture>;

function published(states: State[]) {
  return states.map(s => Number(s.score.toFixed(2)));
}

function nextVoteAccuracy(scores: number[], votes: Ballot[]) {
  let agreement = 0, count = 0;
  for (const vote of votes) for (let i = 0; i < vote.order.length; i++) {
    for (let j = i + 1; j < vote.order.length; j++) {
      const difference = Math.sign(scores[vote.order[i]] - scores[vote.order[j]]);
      agreement += (1 + (vote.lowPole ? -difference : difference)) / 2;
      count++;
    }
  }
  return agreement / count;
}

function run(f: Fixture, strategy: Strategy, detailed: boolean) {
  const states = [...f.base];
  let early = 0, lastUnfixed = 0;
  for (let t = 0; t < horizon; t++) {
    if (typeof strategy === 'string') applyBallot(states, f.ballots[t], strategy);
    else applyCandidate(states, f.ballots[t], strategy);
    if (!detailed) continue;
    if (t === 99) early = correct(published(states), pairs) / pairs.length;
    const low = Math.max(...states.slice(10, 15).map(s => s.score));
    const high = Math.min(...states.slice(40, 45).map(s => s.score));
    if (Number(low.toFixed(2)) >= Number(high.toFixed(2))) lastUnfixed = t + 1;
  }
  const scores = published(states);
  const accuracy = correct(scores, pairs) / pairs.length;
  return { accuracy, near: correct(scores, neighbors) / neighbors.length, early,
    plantedNear: detailed ? correct(scores, flippedNeighbors) / flippedNeighbors.length : 0,
    tied: detailed ? pairs.filter(([a, b]) => scores[a] === scores[b]).length : 0,
    future: detailed ? nextVoteAccuracy(scores, f.ballots.slice(horizon)) : 0,
    recovery: lastUnfixed + 50 <= horizon ? lastUnfixed + 1 : Infinity,
    coverage: detailed ? mean(states.map((s, i) => Number(Math.abs(s.score - truth[i]) <= 1.96 * s.ratingDeviation))) : 0,
    rd: mean(states.map(s => s.ratingDeviation)) };
}

// Each comparison is between two different votes involving the same two
// games. Combining bins only after counting prevents mixing unrelated pairs.
function disagreement(fixtures: Fixture[]) {
  const byGap = Array.from({ length: 11 }, () => ({ opposite: 0, total: 0 }));
  for (const f of fixtures) {
    const seen = new Map<number, { gap: number; wins: number; total: number }>();
    for (const ballot of f.ballots.slice(0, horizon)) {
      const order = ballot.lowPole ? [...ballot.order].reverse() : ballot.order;
      for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
        const a = order[i], b = order[j];
        const key = Math.min(a, b) * truth.length + Math.max(a, b);
        const row = seen.get(key) ?? { gap: Math.abs(truth[a] - truth[b]), wins: 0, total: 0 };
        row.wins += Number(a < b);
        row.total++;
        seen.set(key, row);
      }
    }
    for (const row of seen.values()) {
      byGap[row.gap].opposite += row.wins * (row.total - row.wins);
      byGap[row.gap].total += row.total * (row.total - 1) / 2;
    }
  }
  return [1, 2, 3, 6, 8].map(gap => ({ gap, oppositePercent: pct(byGap[gap].opposite / byGap[gap].total) }));
}

function tune() {
  const fixtures: Fixture[] = [];
  for (const noise of [2, 5] as const) for (const start of ['swapped', 'cold'] as const) {
    for (let i = 0; i < trainSeeds; i++) fixtures.push(fixture(10247 + i * 7919, start, noise));
  }
  const choices = methods.map(method => {
    const candidates = [];
    for (const slopeFactor of [1, 1.75, 2.5, 4]) for (const softBounds of [false, true]) {
      const config = { method, slopeFactor, softBounds };
      const runs = fixtures.map(f => run(f, config, false));
      candidates.push({ config, accuracy: mean(runs.map(r => r.accuracy)), near: mean(runs.map(r => r.near)) });
    }
    candidates.sort((a, b) => b.accuracy - a.accuracy || b.near - a.near);
    return candidates[0];
  });
  choices.sort((a, b) => b.accuracy - a.accuracy || b.near - a.near);
  print('training', { choices, winner: choices[0].config });
  return choices.map(c => c.config);
}

function pairedInterval(values: number[]) {
  const delta = mean(values);
  const se = Math.sqrt(values.reduce((sum, x) => sum + (x - delta) ** 2, 0) / (values.length * (values.length - 1)));
  return [pct(delta - 1.96 * se), pct(delta + 1.96 * se)];
}

function validate(configs: Candidate[], start: Start, noise: Noise, seedBase: number) {
  const fixtures = Array.from({ length: testSeeds }, (_, i) => fixture(seedBase + i * 7919, start, noise));
  print('voter-disagreement', { start, noise, rates: disagreement(fixtures) });
  const winner = configs[0];
  // Hold every other setting fixed to isolate the boundary and slope changes.
  const strategies: Strategy[] = ['adjacent', 'list', ...configs, ...methods.map(method => ({ ...winner, method })),
    { ...winner, softBounds: !winner.softBounds }, { ...winner, slopeFactor: 1 }];
  if (winner.evidenceScale !== undefined) strategies.push({ ...winner, evidenceScale: 1 });
  const runs = new Map<string, ReturnType<typeof run>[]>();
  for (const strategy of strategies) {
    const key = JSON.stringify(strategy);
    if (!runs.has(key)) runs.set(key, fixtures.map(f => run(f, strategy, true)));
  }
  const original = runs.get(JSON.stringify('list'))!;
  const deployed = runs.get(JSON.stringify('adjacent'))!;
  for (const [key, group] of runs) {
    const deltas = group.map((r, i) => r.accuracy - original[i].accuracy);
    const againstDeployed = group.map((r, i) => r.accuracy - deployed[i].accuracy);
    const recovery = group.map(r => r.recovery).filter(Number.isFinite);
    print('validation', { start, noise, strategy: JSON.parse(key),
      all100: pct(mean(group.map(r => r.early))), all500: pct(mean(group.map(r => r.accuracy))),
      near500: pct(mean(group.map(r => r.near))), meanTies: mean(group.map(r => r.tied)),
      plantedNear500: start === 'neighbor-swaps' ? pct(mean(group.map(r => r.plantedNear))) : undefined,
      nextVoter: pct(mean(group.map(r => r.future))), avgRD: Number(mean(group.map(r => r.rd)).toFixed(3)),
      coverage: pct(mean(group.map(r => r.coverage))),
      deltaVsList95: pairedInterval(deltas), deltaVsAdjacent95: pairedInterval(againstDeployed),
      recovery: start === 'swapped' ? { runs: recovery.length, median: recovery.length ? median(recovery) : null } : undefined });
  }
}

// Follow-up after the first screen: a choice that is good on average can
// regress on previously scored games. Select the largest worst-case gain over
// the original list model, with new tuning seeds, before final confirmation.
const scenarios: [Start, Noise][] = [['swapped', 2], ['swapped', 5], ['cold', 'mixed-tastes'], ['perturbed', 'mixed-tastes']];
function tuneStrength(method: Candidate['method']) {
  const panels = scenarios.map(([start, noise]) => {
    const fixtures = Array.from({ length: trainSeeds }, (_, i) => fixture(62000055 + i * 7919, start, noise));
    return { fixtures, baseline: mean(fixtures.map(f => run(f, 'list', false).accuracy)) };
  });
  const grid = [];
  for (const slopeFactor of [1, 1.5, 1.75, 2.5, 3]) for (const evidenceScale of [.75, 1, 1.5, 2]) {
    const config = { method, slopeFactor, evidenceScale, softBounds: true };
    const byPanel = panels.map(panel => panel.fixtures.map(f => run(f, config, false)));
    const gains = byPanel.map((runs, i) => mean(runs.map(r => r.accuracy)) - panels[i].baseline);
    grid.push({ config, gains, worst: Math.min(...gains), near: mean(byPanel.flat().map(r => r.near)) });
  }
  grid.sort((a, b) => b.worst - a.worst || b.near - a.near);
  print('strength-choice', grid[0]);
  return grid[0].config;
}

function sanity() {
  const f = fixture(8, 'perturbed', 2);
  const ballot = { ...f.ballots[0], weight: 2 };
  const old = [...f.base], forward = [...f.base];
  applyBallot(old, ballot, 'list');
  applyCandidate(forward, ballot, { method: 'forward', slopeFactor: 1, softBounds: false });
  assert.deepEqual(old, forward);
  for (const method of methods) for (const softBounds of [true, false]) {
    const config = { method, slopeFactor: 2.5, softBounds };
    const a = [...f.base], b = [...f.base];
    applyCandidate(a, ballot, config);
    applyCandidate(b, { ...ballot, order: [...ballot.order].reverse(), lowPole: !ballot.lowPole }, config);
    assert.deepEqual(a, b);
    a.forEach((state, i) => {
      if (!ballot.order.includes(i)) assert.deepEqual(state, f.base[i]);
      assert(state.score >= 0 && state.score <= 10 && state.ratingDeviation > 0);
      assert(state.ratingDeviation <= f.base[i].ratingDeviation + 1e-12);
      assert.equal(state.directCount, f.base[i].directCount);
    });
    // For a two-game ballot all four objectives reduce to the same logistic comparison.
    const pair = { ...ballot, order: ballot.order.slice(0, 2) };
    const p = [...f.base], q = [...f.base];
    applyCandidate(p, pair, config);
    applyCandidate(q, pair, { ...config, method: 'forward' });
    for (const id of pair.order) {
      assert(Math.abs(p[id].score - q[id].score) < 1e-12);
      assert(Math.abs(p[id].ratingDeviation - q[id].ratingDeviation) < 1e-12);
    }
  }
  // With no prior separation, normalized close-pair weights must still use
  // the whole ballot and allow a cold catalog to start learning.
  const equal = truth.map(() => initial());
  const all = [...equal], cautious = [...equal];
  applyCandidate(all, ballot, { method: 'all-pairs', slopeFactor: 1, softBounds: false });
  applyCandidate(cautious, ballot, { method: 'downweight-close', slopeFactor: 1, softBounds: false });
  assert(all[ballot.order[0]].score !== 5);
  for (const id of ballot.order) assert(Math.abs(all[id].score - cautious[id].score) < 1e-12);
  assert.equal(swapped.length, 25);
}

function timeUpdate(winner: Candidate) {
  for (const n of [6, 100]) {
    const ballot = { order: Array.from({ length: n }, (_, i) => i), lowPole: false, weight: 1 };
    const base = ballot.order.map(() => initial());
    for (const strategy of ['adjacent', 'list', winner] as const) {
      const update = () => typeof strategy === 'string'
        ? applyBallot([...base], ballot, strategy) : applyCandidate([...base], ballot, strategy);
      for (let i = 0; i < 15; i++) update();
      const repetitions = n === 6 ? 200 : 8;
      const times = Array.from({ length: 7 }, () => {
        const t = performance.now();
        for (let i = 0; i < repetitions; i++) update();
        return (performance.now() - t) / repetitions;
      });
      print('local-timing', { n, strategy, medianMs: Number(median(times).toFixed(4)) });
    }
  }
}

sanity();
const choices = tune();
print('phase', { name: 'first-screen' });
for (const [start, noise] of scenarios) validate(choices, start, noise, 157003991);
const winner = tuneStrength(choices[0].method);
print('phase', { name: 'fresh-confirmation' });
for (const [start, noise] of [...scenarios, ['neighbor-swaps', 'mixed-tastes'] as const]) {
  validate([winner], start, noise, 643000021);
}
timeUpdate(winner);
