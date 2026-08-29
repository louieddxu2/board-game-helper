import { describe, expect, test } from 'vitest';
import type { AttributeCatalogPayload } from '../shared/types';
import { availableAttributeSubjectIds, chooseScopedAttributeQuestion, matchCollectionSubjects, parseGeekGroupCollectionCsv, parseCsvRows } from './attributeCollection';

describe('GeekGroup collection import', () => {
  test('parses quoted commas and keeps unique Game IDs only', () => {
    const parsed = parseGeekGroupCollectionCsv([
      '"Collection ID","Game ID",Name',
      '1,123,"Game, One"',
      '2,123,"Game One (copy)"',
      '3,456,"Game Two"',
      '4,-,"No BGG ID"',
    ].join('\n'));

    expect(parsed.bggIds).toEqual([123, 456]);
    expect(parsed.rowCount).toBe(4);
    expect(parsed.skippedRows).toBe(1);
    expect(parsed.idColumn).toBe('Game ID');
  });

  test('supports a quoted multiline field', () => {
    expect(parseCsvRows('Game ID,Name\n123,"Line one\nLine two"')).toEqual([
      ['Game ID', 'Name'],
      ['123', 'Line one\nLine two'],
    ]);
  });
});

const catalog = (): AttributeCatalogPayload => ({
  generation: 1,
  throughVersion: 1,
  generatedAt: 1,
  attributes: [
    { id: 'attribute-luck', key: 'luck', name: '運氣成分', minValue: 0, maxValue: 10, sortOrder: 0 },
  ],
  subjects: [
    { id: 'subject-a', slug: 'a', kind: 'game', displayName: '遊戲甲', components: [{ order: 0, type: 'base', label: '遊戲甲', bggId: 123 }] },
    { id: 'subject-b', slug: 'b', kind: 'game', displayName: '遊戲乙', components: [{ order: 0, type: 'base', label: '遊戲乙', bggId: 456 }] },
    { id: 'subject-c', slug: 'c', kind: 'game', displayName: '遊戲丙', components: [{ order: 0, type: 'base', label: '遊戲丙', bggId: 789 }] },
  ],
  values: [
    { subjectId: 'subject-a', attributeId: 'attribute-luck', score: 5, ratingDeviation: 3, directCount: 0, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 0, modelVersion: 'glicko-rd-v1' },
    { subjectId: 'subject-b', attributeId: 'attribute-luck', score: 5.2, ratingDeviation: 1, directCount: 1, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 1, modelVersion: 'glicko-rd-v1' },
    { subjectId: 'subject-c', attributeId: 'attribute-luck', score: 9, ratingDeviation: 3, directCount: 0, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 0, modelVersion: 'glicko-rd-v1' },
  ],
  candidates: [],
  activities: [],
  scoreModelVersion: 'glicko-rd-v1',
});

describe('local attribute collection question selection', () => {
  test('maps imported IDs to canonical game subjects', () => {
    expect(matchCollectionSubjects(catalog(), [123, 123, 999, 456])).toEqual({
      subjectIds: ['subject-a', 'subject-b'],
      matchedBggIds: [123, 456],
    });
  });

  test('maps alternate BGG edition IDs to the same canonical subject', () => {
    const withEditions = catalog();
    withEditions.subjects[0] = {
      ...withEditions.subjects[0],
      bggIds: [306881, 306882],
    };

    expect(matchCollectionSubjects(withEditions, [306882, 306881, 456])).toEqual({
      subjectIds: ['subject-a', 'subject-b'],
      matchedBggIds: [306882, 306881, 456],
    });
  });

  test('keeps every votable configuration attached to a collected BGG game', () => {
    const withConfiguration = catalog();
    withConfiguration.subjects.push({
      id: 'subject-a-expansion',
      slug: 'a-expansion',
      kind: 'configuration',
      displayName: '遊戲甲＋擴充',
      components: [{ order: 0, type: 'base', label: '遊戲甲', bggId: 123 }],
    });

    expect(matchCollectionSubjects(withConfiguration, [123]).subjectIds).toEqual(['subject-a', 'subject-a-expansion']);
  });

  test('selects a pair without adding IDs to a server query', () => {
    expect(chooseScopedAttributeQuestion(catalog(), ['subject-a', 'subject-b'], {}, 0)).toEqual({
      subjectAId: 'subject-a',
      subjectBId: 'subject-b',
      attributeId: 'attribute-luck',
    });
  });

  test('replaces only one side while preserving the other side and attribute', () => {
    expect(chooseScopedAttributeQuestion(catalog(), ['subject-a', 'subject-b', 'subject-c'], {
      excludeSubjectAId: 'subject-a',
      excludeSubjectBId: 'subject-b',
      excludeAttributeId: 'attribute-luck',
      fixedSubjectBId: 'subject-b',
      fixedAttributeId: 'attribute-luck',
    }, 0)).toEqual({
      subjectAId: 'subject-c',
      subjectBId: 'subject-b',
      attributeId: 'attribute-luck',
    });
  });

  test('applies the same local cooldown to the complete and collection scopes', () => {
    const deferred = [{
      subjectId: 'subject-a',
      bggIds: [123],
      skipCount: 1,
      skippedAt: 1,
      eligibleAfterQuestion: 20,
      eligibleAfterAt: 10_000,
    }];

    expect(availableAttributeSubjectIds(catalog(), undefined, deferred, 5, 100)).toEqual(['subject-b', 'subject-c']);
    expect(availableAttributeSubjectIds(catalog(), ['subject-a', 'subject-b', 'subject-c'], deferred, 5, 100)).toEqual(['subject-b', 'subject-c']);
    expect(availableAttributeSubjectIds(catalog(), undefined, deferred, 20, 100)).toEqual(['subject-a', 'subject-b', 'subject-c']);
  });

  test('releases the nearest cooldown locally when a scope would have fewer than two choices', () => {
    const deferred = [{
      subjectId: 'old-subject-id',
      bggIds: [123],
      skipCount: 2,
      skippedAt: 1,
      eligibleAfterQuestion: 80,
      eligibleAfterAt: 20_000,
    }];

    expect(availableAttributeSubjectIds(catalog(), ['subject-a', 'subject-b'], deferred, 5, 100)).toEqual(['subject-b', 'subject-a']);
  });
});
