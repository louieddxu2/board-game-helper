import type { Ballot } from './models';

export const truth = Array.from({ length: 55 }, (_, id) => Math.floor(id / 5));
const ids = truth.map((_, i) => i);
export const pairs = ids.flatMap(low => ids.filter(high => truth[high] > truth[low]).map(high => [low, high] as const));
export const neighbors = pairs.filter(([low, high]) => truth[high] - truth[low] === 1);
export const swapped = pairs.filter(([low, high]) => truth[low] === 2 && truth[high] === 8);

function chooseWideGames(random: () => number) {
  let chosen: number[];
  do {
    const pool = [...ids];
    for (let i = 0; i < 6; i++) {
      const j = i + Math.floor(random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    chosen = pool.slice(0, 6);
  } while (Math.max(...chosen.map(id => truth[id])) - Math.min(...chosen.map(id => truth[id])) < 8);
  return chosen;
}

function rankPerceptions(random: () => number, perceptions: { id: number; score: number; tieBreaker: number }[]): Ballot {
  const order = perceptions.sort((a, b) => b.score - a.score || b.tieBreaker - a.tieBreaker).map(v => v.id);
  const lowPole = random() < .5;
  return { order: lowPole ? order.reverse() : order, lowPole, weight: 1 };
}

export function drawBallot(random: () => number, spread: number, taste?: readonly number[]): Ballot {
  const perceptions = chooseWideGames(random).map(id => ({
    id, score: Math.max(0, Math.min(10, truth[id] + (taste?.[id] ?? 0) + Math.floor(random() * (2 * spread + 1)) - spread)),
    tieBreaker: random(),
  }));
  return rankPerceptions(random, perceptions);
}

// The difference of two independent perception errors is normal with
// standard deviation sqrt(2) * sigma. At a one-point gap Phi(-1/(sqrt(2)*sigma)) = 0.4.
const normalQuantile60 = 0.2533471031357997;
const perceptionSd = 1 / (Math.SQRT2 * normalQuantile60);

export function drawBallotWithCappedMistakes(random: () => number): Ballot {
  const perceptions = chooseWideGames(random).map(id => {
    const error = perceptionSd * Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    return { id, score: truth[id] + error, tieBreaker: random() };
  });
  return rankPerceptions(random, perceptions);
}

// Strictly resolved order at the precision published in the catalog.
export function correct(scores: number[], subset: typeof pairs) {
  let count = 0;
  for (const [low, high] of subset) if (scores[low] < scores[high]) count++;
  return count;
}
