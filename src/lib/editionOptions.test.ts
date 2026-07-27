import { describe, expect, test } from 'vitest';
import { collectEditionOptions, findEditionOption, mergeEditionOptions } from './editionOptions';

describe('edition options', () => {
  test('aggregates repeated values and places common choices first', () => {
    const options = collectEditionOptions([
      { editionNote: '挪威人擴充' },
      { editionNote: '修訂版' },
      { editionNotes: ['挪威人擴充', '農夫擴充'] },
      { editionNote: '  ' },
    ]);
    expect(options[0]).toBe('挪威人擴充');
    expect(new Set(options)).toEqual(new Set(['挪威人擴充', '修訂版', '農夫擴充']));
  });

  test('deduplicates harmless input differences', () => {
    expect(mergeEditionOptions(['Revised Edition'], [' revised edition ', '其他擴充']))
      .toEqual(['Revised Edition', '其他擴充']);
    expect(findEditionOption(['Revised Edition'], ' REVISED EDITION ')).toBe('Revised Edition');
  });
});
