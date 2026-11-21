import assert from 'node:assert/strict';
import { applyBallot, initial, type Ballot } from './ranking-research/models';
import { mean, median, randomSource } from './ranking-research/simulation';

// Five distinct subjects at each integer level. Only cross-level order is observable.
const truth = Array.from({ length: 55 }, (_, id) => Math.floor(id / 5));
const ids = truth.map((_, i) => i);
const models = ['adjacent', 'list'] as const;
const trials = 100;
const horizon = 500;
const checkpoints = new Set([0, 100, 250, horizon]);
const pairs = ids.flatMap(low => ids.filter(high => truth[high] > truth[low]).map(high => [low, high] as const));
const neighbors = pairs.filter(([low, high]) => truth[high] - truth[low] === 1);
const swapped = pairs.filter(([low, high]) => truth[low] === 2 && truth[high] === 8);
assert.deepEqual([pairs.length, neighbors.length, swapped.length], [1375, 250, 25]);

function drawBallot(random: () => number, spread: number): Ballot {
  let chosen: number[];
  do {
    const pool = [...ids];
    for (let i = 0; i < 6; i++) {
      const j = i + Math.floor(random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    chosen = pool.slice(0, 6);
  } while (Math.max(...chosen.map(id => truth[id])) - Math.min(...chosen.map(id => truth[id])) < 8);
  const perceptions = chosen.map(id => ({
    id, score: Math.max(0, Math.min(10, truth[id] + Math.floor(random() * (2 * spread + 1)) - spread)),
    tieBreaker: random(),
  }));
  const order = perceptions.sort((a, b) => b.score - a.score || b.tieBreaker - a.tieBreaker).map(v => v.id);
  const lowPole = random() < .5;
  return { order: lowPole ? order.reverse() : order, lowPole, weight: 1 };
}

// Strictly resolved order at the precision published in the catalog.
function correct(scores: number[], subset: typeof pairs) {
  let count = 0;
  for (const [low, high] of subset) if (scores[low] < scores[high]) count++;
  return count;
}

function experiment(spread: number) {
  const round = (value: number) => Number(value.toFixed(2));
  const stats = models.map(() => [...checkpoints].map(votes =>
    ({ votes, overall: 0, neighbors: 0, swapped: 0, perfectTrials: 0, allSwapsFixed: 0 })));
  const recoveryTimes: number[][] = models.map(() => []);
  const pairedEndCounts: number[][] = models.map(() => []);
  for (let trial = 0; trial < trials; trial++) {
    const random = randomSource(10247 + 7919 * trial);
    const states = models.map(() => truth.map(value => initial(value === 2 ? 8 : value === 8 ? 2 : value, 1.5)));
    const lastUncorrected = models.map(() => 0);
    for (let votes = 0; votes <= horizon; votes++) {
      const ballot = votes ? drawBallot(random, spread) : undefined;
      models.forEach((model, i) => {
        if (ballot) applyBallot(states[i], ballot, model);
        const scores = states[i].map(state => Number(state.score.toFixed(2)));
        const swappedCorrect = correct(scores, swapped);
        if (swappedCorrect < swapped.length) lastUncorrected[i] = votes;
        if (!checkpoints.has(votes)) return;
        const result = stats[i].find(row => row.votes === votes)!;
        const total = correct(scores, pairs);
        result.overall += total;
        result.neighbors += correct(scores, neighbors);
        result.swapped += swappedCorrect;
        result.perfectTrials += Number(total === pairs.length);
        result.allSwapsFixed += Number(swappedCorrect === swapped.length);
        if (votes === horizon) pairedEndCounts[i].push(total);
      });
    }
    // Require all 25 crossed pairs to stay fixed through the end for at least 50 ballots.
    lastUncorrected.forEach((last, i) => {
      if (last + 50 <= horizon) recoveryTimes[i].push(last + 1);
    });
  }
  models.forEach((model, i) => {
    for (const r of stats[i]) {
      console.log(JSON.stringify({ spread, model, votes: r.votes,
        correctPercent: round(100 * r.overall / (trials * pairs.length)),
        neighborPercent: round(100 * r.neighbors / (trials * neighbors.length)),
        swappedPercent: round(100 * r.swapped / (trials * swapped.length)),
        perfectTrials: r.perfectTrials, allSwapsFixed: r.allSwapsFixed }));
    }
    const times = recoveryTimes[i];
    console.log(JSON.stringify({ spread, model, sustainedTrials: times.length,
      medianSustainedBallot: times.length ? median(times) : null }));
  });
  const differences = pairedEndCounts[1].map((total, i) => 100 * (total - pairedEndCounts[0][i]) / pairs.length);
  const delta = mean(differences);
  const se = Math.sqrt(differences.reduce((sum, d) => sum + (d - delta) ** 2, 0) / (trials * (trials - 1)));
  console.log(JSON.stringify({ spread, listWon: differences.filter(d => d > 0).length,
    same: differences.filter(d => d === 0).length,
    deltaPoints: round(delta), paired95: [round(delta - 1.96 * se), round(delta + 1.96 * se)] }));
}

assert.equal(correct(truth, pairs), pairs.length);
assert.equal(correct(truth.map(() => 5), pairs), 0);
for (const spread of [2, 5]) experiment(spread);
