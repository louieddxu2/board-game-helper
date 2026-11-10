/** Deterministic randomness and failure minimisation for the backup simulator. */
export interface Random {
  next(): number;
  int(maxExclusive: number): number;
  pick<Value>(values: readonly Value[]): Value;
  chance(probability: number): boolean;
  weighted<Value>(choices: readonly (readonly [number, Value])[]): Value;
}

export const createRandom = (seed: number): Random => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    pick: values => values[int(values.length)],
    chance: probability => next() < probability,
    weighted: choices => {
      let remaining = next() * choices.reduce((total, [weight]) => total + weight, 0);
      for (const [weight, value] of choices) {
        remaining -= weight;
        if (remaining < 0) return value;
      }
      return choices[choices.length - 1][1];
    },
  };
};

/**
 * Delta debugging: remove ever smaller chunks while the same failure persists, then try
 * each caller-supplied simplification of a single step. The result is 1-minimal for removal.
 */
export const shrinkSequence = async <Step>(
  steps: readonly Step[],
  stillFails: (candidate: readonly Step[]) => Promise<boolean>,
  simplify: (step: Step) => Step[] = () => [],
): Promise<Step[]> => {
  let current = [...steps];
  let chunk = Math.max(1, Math.floor(current.length / 2));
  for (;;) {
    let removed = false;
    for (let start = 0; start < current.length;) {
      const candidate = [...current.slice(0, start), ...current.slice(start + chunk)];
      if (await stillFails(candidate)) {
        current = candidate;
        removed = true;
      } else start += chunk;
    }
    if (removed) chunk = Math.max(1, Math.min(chunk, Math.floor(current.length / 2)));
    else if (chunk === 1) break;
    else chunk = Math.floor(chunk / 2);
  }
  let budget = current.length * 8;
  for (let index = 0; index < current.length; index += 1) {
    for (const simpler of simplify(current[index])) {
      const candidate = [...current.slice(0, index), simpler, ...current.slice(index + 1)];
      if ((budget -= 1) >= 0 && await stillFails(candidate)) { current = candidate; index -= 1; break; }
    }
  }
  return current;
};
