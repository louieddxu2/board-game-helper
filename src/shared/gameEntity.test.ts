import { describe, expect, it } from 'vitest';
import { classifyGameEntityLabel, normalizeGameEntityLabel } from './gameEntity';

describe('game entity labels', () => {
  it('classifies expansion labels before version labels', () => {
    expect(classifyGameEntityLabel('農家樂擴充')).toBe('expansion');
    expect(classifyGameEntityLabel('The Ketchup Mechanism Expansion')).toBe('expansion');
  });

  it('classifies common version labels', () => {
    expect(classifyGameEntityLabel('豪華版')).toBe('version');
    expect(classifyGameEntityLabel('Shipyard (Second Edition)')).toBe('version');
  });

  it('keeps ambiguous labels explicit', () => {
    expect(classifyGameEntityLabel('Promo')).toBe('unknown');
  });

  it('normalizes punctuation and spacing for matching', () => {
    expect(normalizeGameEntityLabel('  Shipyard（Second Edition） ')).toBe('shipyardsecondedition');
  });
});
