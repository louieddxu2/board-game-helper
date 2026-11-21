import assert from 'node:assert/strict';
import { applyBallot, initial } from './ranking-research/models';
import { correct, drawBallot, neighbors, pairs, swapped, truth } from './ranking-research/order-fixture';
import { mean, median, pearsonCorrelation, randomSource } from './ranking-research/simulation';

const models = ['adjacent', 'list'] as const;
const trials = 100;
const horizon = 500;
const checkpoints = new Set([0, 100, 250, horizon]);
assert.deepEqual([pairs.length, neighbors.length, swapped.length], [1375, 250, 25]);

// Each tied observation gets the average of the positions occupied by its group.
function midranks(values: number[]) {
  const positions = [...values].sort((a, b) => a - b);
  return values.map(v => (positions.indexOf(v) + positions.lastIndexOf(v)) / 2 + 1);
}

const truthRanks = midranks(truth);
function finalFit(scores: number[]) {
  // For one predictor and an intercept, in-sample OLS R² is squared Pearson r.
  return { spearman: pearsonCorrelation(midranks(scores), truthRanks), rSquared: pearsonCorrelation(scores, truth) ** 2,
    ties: pairs.filter(([low, high]) => scores[low] === scores[high]).length };
}

function experiment(spread: number) {
  const round = (value: number) => Number(value.toFixed(2));
  const stats = models.map(() => [...checkpoints].map(votes =>
    ({ votes, overall: 0, neighbors: 0, swapped: 0, perfectTrials: 0, allSwapsFixed: 0 })));
  const recoveryTimes: number[][] = models.map(() => []);
  const pairedEndCounts: number[][] = models.map(() => []);
  const fits: ReturnType<typeof finalFit>[][] = models.map(() => []);
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
        if (votes === horizon) {
          pairedEndCounts[i].push(total);
          fits[i].push(finalFit(scores));
        }
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
    const end = fits[i];
    console.log(JSON.stringify({ spread, model, firstTrial: { correct: pairedEndCounts[i][0], ...end[0] },
      meanSpearman: mean(end.map(f => f.spearman)), meanRSquared: mean(end.map(f => f.rSquared)),
      meanTies: mean(end.map(f => f.ties)),
      meanReversed: mean(end.map((f, t) => pairs.length - pairedEndCounts[i][t] - f.ties)) }));
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
assert.deepEqual(midranks([4, 2, 4, 3]), [3.5, 1, 3.5, 2]);
assert.deepEqual(finalFit(truth), { spearman: 1, rSquared: 1, ties: 0 });
assert.deepEqual(finalFit(truth.map(v => 10 - v)), { spearman: -1, rSquared: 1, ties: 0 });
for (const spread of [2, 5]) experiment(spread);
