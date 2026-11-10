import { describe, expect, test } from 'vitest';
import { createRandom, shrinkSequence } from './random';

describe('simulation randomness', () => {
  test('the same seed always yields the same history', () => {
    const draw = (seed: number) => { const random = createRandom(seed); return Array.from({ length: 20 }, () => random.int(1000)); };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  test('shrinking keeps exactly the steps a failure needs, in order', async () => {
    const steps = Array.from({ length: 40 }, (_, index) => index);
    const needs = [3, 17, 31];
    let runs = 0;
    const minimal = await shrinkSequence(steps, async candidate => {
      runs += 1;
      let next = 0;
      for (const step of candidate) if (step === needs[next]) next += 1;
      return next === needs.length;
    });
    expect(minimal).toEqual(needs);
    expect(runs).toBeLessThan(200);
  });

  test('shrinking then simplifies the surviving steps', async () => {
    const minimal = await shrinkSequence([5, 9, 12], async candidate => candidate.some(step => step >= 9 && step % 3 === 0),
      step => step > 9 ? [step - 3] : []);
    expect(minimal).toEqual([9]);
  });
});
