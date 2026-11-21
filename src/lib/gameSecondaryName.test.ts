import { describe, expect, it } from 'vitest';
import { secondaryGameName } from './gameSecondaryName';

describe('secondaryGameName', () => {
  it('gives a Chinese title its English name', () => {
    expect(secondaryGameName('石油公司', 'Pipeline', ['輸油管'])).toBe('Pipeline');
  });

  it('gives an English title a Chinese alias', () => {
    expect(secondaryGameName('Voyages', null, ['Voyages', '航行'])).toBe('航行');
  });

  it('falls back to another alias in the same script', () => {
    expect(secondaryGameName('契約石', undefined, ['契约石'])).toBe('契约石');
  });

  it('shows nothing when every name repeats the title', () => {
    expect(secondaryGameName('Azul', 'azul ', ['AZUL'])).toBeUndefined();
    expect(secondaryGameName('花磚物語')).toBeUndefined();
  });
});
