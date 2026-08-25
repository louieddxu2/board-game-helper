import { describe, expect, test } from 'vitest';
import type { AttributeCatalogPayload } from '../shared/types';
import { applyAttributeCatalogChanges } from './attributeCatalog';

const base: AttributeCatalogPayload = {
  generation: 1,
  throughVersion: 10,
  generatedAt: 123,
  attributes: [{ id: 'attribute-luck', key: 'luck', name: '運氣', minValue: 0, maxValue: 10, sortOrder: 0 }],
  subjects: [{ id: 'subject-a', slug: 'game-a', kind: 'game', displayName: '舊名稱', gameSlug: 'game-a' }],
  values: [{ subjectId: 'subject-a', attributeId: 'attribute-luck', score: 5, ratingDeviation: 3, directCount: 0, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 0, modelVersion: 'glicko-rd-v1' }],
  candidates: [{ id: 'candidate-1', displayName: '待處理', values: [8], matchStatus: 'pending', sourceRowNumber: 1 }],
  activities: [],
  scoreModelVersion: 'glicko-rd-v1',
};

describe('attribute table catalog delta application', () => {
  test('updates score and subject metadata without rebuilding the complete matrix', () => {
    const updated = applyAttributeCatalogChanges(base, [
      { entryKey: 'attribute:attribute-luck', catalogVersion: 10, deleted: false, attribute: { ...base.attributes[0], name: '新的運氣' } },
      { entryKey: 'subject:subject-a', catalogVersion: 11, deleted: false, subject: { ...base.subjects[0], displayName: '新名稱' } },
      { entryKey: 'value:subject-a:attribute-luck', catalogVersion: 12, deleted: false, value: { ...base.values[0], score: 7.5 }, subject: { ...base.subjects[0], displayName: '新名稱' } },
      { entryKey: 'candidate:candidate-2', catalogVersion: 13, deleted: false, candidate: { id: 'candidate-2', displayName: '新候選', values: [6], matchStatus: 'ambiguous', sourceRowNumber: 2 } },
    ]);

    expect(updated.throughVersion).toBe(13);
    expect(updated.attributes[0].name).toBe('新的運氣');
    expect(updated.subjects[0].displayName).toBe('新名稱');
    expect(updated.values[0].score).toBe(7.5);
    expect(updated.candidates).toHaveLength(2);
  });

  test('removes deleted subjects, values, and candidates', () => {
    const updated = applyAttributeCatalogChanges(base, [
      { entryKey: 'value:subject-a:attribute-luck', catalogVersion: 11, deleted: true },
      { entryKey: 'subject:subject-a', catalogVersion: 12, deleted: true },
      { entryKey: 'candidate:candidate-1', catalogVersion: 13, deleted: true },
    ]);

    expect(updated.subjects).toEqual([]);
    expect(updated.values).toEqual([]);
    expect(updated.candidates).toEqual([]);
  });

  test('does not retain a candidate once it is no longer unprocessed', () => {
    const updated = applyAttributeCatalogChanges(base, [{
      entryKey: 'candidate:candidate-1',
      catalogVersion: 11,
      deleted: false,
      candidate: { ...base.candidates[0], matchStatus: 'matched', subjectId: 'subject-a' },
    }]);

    expect(updated.candidates).toEqual([]);
  });
});
