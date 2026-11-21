import type { Ballot } from './models';

export const truth = Array.from({ length: 55 }, (_, id) => Math.floor(id / 5));
const ids = truth.map((_, i) => i);
export const pairs = ids.flatMap(low => ids.filter(high => truth[high] > truth[low]).map(high => [low, high] as const));
export const neighbors = pairs.filter(([low, high]) => truth[high] - truth[low] === 1);
export const swapped = pairs.filter(([low, high]) => truth[low] === 2 && truth[high] === 8);

export function drawBallot(random: () => number, spread: number, taste?: readonly number[]): Ballot {
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
    id, score: Math.max(0, Math.min(10, truth[id] + (taste?.[id] ?? 0) + Math.floor(random() * (2 * spread + 1)) - spread)),
    tieBreaker: random(),
  }));
  const order = perceptions.sort((a, b) => b.score - a.score || b.tieBreaker - a.tieBreaker).map(v => v.id);
  const lowPole = random() < .5;
  return { order: lowPole ? order.reverse() : order, lowPole, weight: 1 };
}

// Strictly resolved order at the precision published in the catalog.
export function correct(scores: number[], subset: typeof pairs) {
  let count = 0;
  for (const [low, high] of subset) if (scores[low] < scores[high]) count++;
  return count;
}
