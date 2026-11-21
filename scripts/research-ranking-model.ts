// Run with node --import tsx scripts/research-ranking-model.ts. Synthetic data only.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { applyDirectRating, emptyAttributeState } from '../worker/data/attributeScoring';
import { applyBallot, initial, slope, type Ballot, type Model } from './ranking-research/models';
import { checkpoints, makeFixture, mean, median, runSeries, seedCount, type Scenario } from './ranking-research/simulation';

const round = (value: number) => Number(value.toFixed(3));
const print = (event: string, data: object) => console.log(JSON.stringify({ event, ...data }));
const ballotFor = (size: number, weight = 1): Ballot => ({
  order: Array.from({ length: size }, (_, i) => i), lowPole: false, weight,
});

function sanityChecks() {
  const fixture = makeFixture('wide-noisy', 17);
  const source = fixture.ballots[0];
  const ref = { ...source.reference!, confirmed: true };
  const ballot = { ...source, reference: ref };
  const update = (vote: Ballot, model: Model) => {
    const states = [...fixture.base];
    applyBallot(states, vote, model);
    return states;
  };
  const after = update(ballot, 'anchor');
  assert.deepEqual(after, update({ ...ballot, lowPole: !ballot.lowPole, order: [...ballot.order].reverse() }, 'anchor'));
  assert.deepEqual(update({ ...ballot, reference: { ...ref, confirmed: false } }, 'anchor'), update(ballot, 'list'));
  assert.deepEqual(update({ ...ballot, reference: undefined }, 'anchor'), update(ballot, 'list'));
  after.forEach((s, i) => {
    if (!ballot.order.includes(i)) assert.deepEqual(s, fixture.base[i]);
    assert.equal(s.directCount, fixture.base[i].directCount);
    assert.equal(s.directSum, fixture.base[i].directSum);
    assert(s.ratingDeviation <= fixture.base[i].ratingDeviation + 1e-12);
  });
  // Two equal priors: the joint logistic Hessian has a common-shift
  // eigenvalue 1/9 and a difference eigenvalue 1/9 + weight * slope²/2.
  for (const weight of [1, 1.5, 2]) {
    const states = [initial(), initial()];
    applyBallot(states, ballotFor(2, weight), 'list');
    const contrastVariance = 1 / (1 / 9 + weight * slope ** 2 / 2);
    assert(Math.abs(states[0].score - 5 - weight * slope / 2 * contrastVariance) < 1e-10);
    assert(Math.abs(states[0].ratingDeviation ** 2 - (9 + contrastVariance) / 2) < 1e-10);
  }
}

function series(scenario: Scenario) {
  const models: Model[] = ['adjacent', 'list', 'one-pair-budget', 'anchor'];
  if (scenario.startsWith('wide-')) models.push('steeper-list');
  if (scenario === 'high-island') models.push('blind-control');
  const fixtures = Array.from({ length: seedCount }, (_, i) => makeFixture(scenario, 7391 + i * 7919));
  const ballots = fixtures.flatMap(f => f.ballots);
  const confirmed = ballots.filter(b => b.reference?.confirmed);
  let distant = 0, disagree = 0;
  for (const f of fixtures) for (const b of f.ballots) {
    for (let i = 0; i < b.order.length; i++) for (let j = i + 1; j < b.order.length; j++) {
      const gap = f.truth[b.order[i]] - f.truth[b.order[j]];
      if (Math.abs(gap) < 3) continue;
      distant++;
      disagree += Number(b.lowPole ? gap > 0 : gap < 0);
    }
  }
  print('sample', { scenario, seeds: seedCount,
    meanSpan: round(mean(fixtures.flatMap(f => f.ballots.map(b => {
      const values = b.order.map(id => f.truth[id]);
      return Math.max(...values) - Math.min(...values);
    })))), confirmed: confirmed.length, confirmedEditor: confirmed.filter(b => b.weight === 2).length,
    ballots: ballots.length, distantDisagreementPercent: distant ? round(100 * disagree / distant) : null });
  let baseline: ReturnType<typeof runSeries>[] = [];
  for (const model of models) {
    const runs = fixtures.map(f => runSeries(f, model));
    if (model === 'adjacent') baseline = runs;
    const at = (votes: number) => runs.map(r => r.curve[checkpoints.indexOf(votes)]);
    const end = at(160);
    const stable = runs.map(r => r.stableFrom).filter(Number.isFinite);
    const differences = end.map((m, i) => m.mae - baseline[i].curve.at(-1)!.mae);
    const delta = mean(differences);
    const se = Math.sqrt(differences.reduce((sum, x) => sum + (x - delta) ** 2, 0) / (seedCount * (seedCount - 1)));
    print('series', { scenario, model,
      checkpoints: [0, 20, 80, 160].map(votes => ({ votes, mae: round(mean(at(votes).map(m => m.mae))),
        wrongPercent: round(100 * mean(at(votes).map(m => m.inversions))),
        plantedFixed: scenario === 'high-island' ? null : at(votes).filter(m => m.plantedFixed).length })),
      stableSeeds: stable.length, medianStableAmongFinishers: stable.length ? median(stable) : null,
      endRD: round(mean(end.map(m => m.rd))), coveragePercent: round(100 * mean(end.map(m => m.coverage))),
      reverseDifference: round(mean(runs.map(r => r.orderSensitivity))),
      endTightError: round(mean(runs.map(r => r.tightError))),
      endLooseError: scenario !== 'high-island' ? round(mean(runs.map(r => r.looseError!))) : null,
      pairedMaeDelta: round(delta), paired95: [round(delta - 1.96 * se), round(delta + 1.96 * se)] });
  }
}

function replayEdits() {
  const fixture = makeFixture('high-island', 947);
  const player = 4, reference = fixture.truth.length + 1;
  const votes = fixture.ballots.slice(0, 80).map(b => ({
    ...b, reference: { ...b.reference!, displayedScore: 9.5 },
  }));
  // These initial observations represent editable direct votes. This is an
  // in-memory replay from the edited source, not an edit to the last score.
  function replay(manual: number, referenceManual: number, useReplayedRef: boolean, legacy: boolean) {
    const states = [...fixture.base];
    states[player] = applyDirectRating(emptyAttributeState(), manual).next;
    states[reference] = applyDirectRating(emptyAttributeState(), referenceManual).next;
    const refBefore = { ...states[reference] };
    for (const b of votes) applyBallot(states, legacy ? { ...b, reference: undefined } : b, 'anchor', useReplayedRef);
    assert.deepEqual(states[reference], refBefore);
    assert.equal(states[player].directCount, 1);
    assert.equal(states[player].directSum, manual);
    return states.slice(0, fixture.truth.length).map(s => s.score);
  }
  const old = replay(2, 9.5, false, false);
  const edited = replay(7, 9.5, false, false);
  const frozen = replay(7, 8.5, false, false);
  const reconstructed = replay(7, 8.5, true, false);
  const legacy = replay(7, 8.5, true, true);
  assert.deepEqual(edited, frozen);
  assert.deepEqual(legacy, replay(7, 9.5, false, true));
  assert.deepEqual(reconstructed, replay(7, 8.5, true, false));
  assert(Math.abs(edited[player] - old[player]) > 0.1);
  assert(frozen.some((s, i) => Math.abs(s - reconstructed[i]) > 0.01));
  const maxDifference = (a: number[], b: number[]) => Math.max(...a.map((s, i) => Math.abs(s - b[i])));
  print('edited-history', { player, selfBefore: round(old[player]), selfAfter: round(edited[player]),
    snapshotAfterReferenceEdit: round(frozen[player]), replayedReferenceAfterEdit: round(reconstructed[player]),
    legacySelfOnly: round(legacy[player]), maxSnapshotVsReplayed: round(maxDifference(frozen, reconstructed)),
    maxEditSpillover: round(maxDifference(old.filter((_, i) => i !== player), edited.filter((_, i) => i !== player))) });

  // A later genuine direct rating of the reference is a distinct event.
  // All these synthetic ballots used the same cached display snapshot.
  function laterRating(at: number, useReplayedRef: boolean) {
    const states = [...fixture.base];
    states[reference] = applyDirectRating(emptyAttributeState(), 9.5).next;
    for (const [i, b] of votes.entries()) {
      if (i === at) states[reference] = applyDirectRating(states[reference], 6).next;
      applyBallot(states, b, 'anchor', useReplayedRef);
    }
    if (at === votes.length) states[reference] = applyDirectRating(states[reference], 6).next;
    assert.equal(states[reference].directCount, 2);
    return states.slice(0, fixture.truth.length).map(s => s.score);
  }
  assert.deepEqual(laterRating(40, false), laterRating(80, false));
  const difference = maxDifference(laterRating(40, true), laterRating(80, true));
  assert(difference > 0);
  print('later-reference-rating', { maxDifferenceAsOf: round(difference), maxDifferenceSnapshot: 0 });
}

function unconfirmedPlacement() {
  // Exactly the same player evidence; only the direction in which the page
  // prefilled examples precede the player's appended games changes.
  const fixture = makeFixture('high-island', 947);
  function replay(lowPole: boolean, model: Model) {
    const states = [...fixture.base];
    for (const b of fixture.ballots) {
      const order = lowPole === b.lowPole ? b.order : [...b.order].reverse();
      applyBallot(states, { ...b, order, lowPole, reference: { ...b.reference!, confirmed: false } }, model);
    }
    return states.slice(0, fixture.truth.length).map(s => s.score);
  }
  for (const model of ['anchor', 'blind-control'] as const) {
    const low = replay(true, model), high = replay(false, model);
    const difference = mean(low.map((v, i) => Math.abs(v - high[i])));
    if (model === 'anchor') assert.deepEqual(low, high);
    else assert(difference > 0.1);
    print('unconfirmed', { model, meanDifference: round(difference), maxDifference: round(Math.max(...low.map((v, i) => Math.abs(v - high[i])))) });
  }
}

function ballotSize() {
  for (const n of [2, 6, 18, 100]) for (const model of ['adjacent', 'list', 'one-pair-budget'] as const) {
    const ballot = ballotFor(n);
    const priors = ballot.order.map(() => initial());
    function update() {
      const states = [...priors];
      applyBallot(states, ballot, model);
      return states;
    }
    const states = update();
    for (let i = 0; i < 10; i++) update();
    const times: number[] = [];
    const repeats = n === 100 ? 8 : 100;
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      for (let j = 0; j < repeats; j++) update();
      times.push((performance.now() - start) / repeats);
    }
    print('size', { n, model, sumAbsMove: round(states.reduce((sum, s) => sum + Math.abs(s.score - 5), 0)),
      meanRD: round(mean(states.map(s => s.ratingDeviation))), medianLocalMs: round(median(times)),
      scores: n === 6 ? states.map(s => round(s.score)) : undefined });
  }
}

sanityChecks();
for (const scenario of ['wide-noisy', 'wide-gaussian', 'wide-consistent', 'near-noisy', 'high-island'] as const) series(scenario);
replayEdits();
unconfirmedPlacement();
ballotSize();
