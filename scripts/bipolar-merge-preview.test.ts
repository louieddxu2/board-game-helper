import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWinMergePreview, mergeWinScore, renderWinMergePreview, WIN_CORRECTIONS } from './bipolar-merge-preview';
import type { AttributeCatalogPayload, AttributeMatrixValue } from '../src/shared/types';

const fixture = (): AttributeCatalogPayload => ({
  generation: 1, throughVersion: 1, generatedAt: 1, activities: [], candidates: [], values: [],
  attributes: [
    { id: 'score', key: 'score_race', name: '得分取勝', fullDescription: ' 得分原文\n第二行 ', minValue: 0, maxValue: 10, sortOrder: 0 },
    { id: 'condition', key: 'end_condition', name: '條件取勝', fullDescription: '條件原文', minValue: 0, maxValue: 10, sortOrder: 1 },
  ],
  subjects: [...WIN_CORRECTIONS.map((correction) => ({ id: correction.subjectId, displayName: correction.name, slug: correction.subjectId, kind: 'game' as const })),
    { id: 'other', displayName: '其他', slug: 'other', kind: 'game' }],
});
const state = (attributeId: string, score: number, evidenceCount = 1): AttributeMatrixValue => ({ subjectId: 'other', attributeId, score, evidenceCount, directCount: evidenceCount, comparisonCount: 0, decisiveComparisonCount: 0, modelVersion: 'glicko-rd-v1' });

test.each([
  [10, 0, 0], [0, 10, 10], [0, 0, 5], [10, 10, 5], [3, 8, 7.5], [4.76, 7, 6.12],
  [null, 0, 0], [10, null, 0], [null, null, null], [null, 8, 8],
] as const)('averages %s / %s into %s without inferring a ratio', (score, condition, expected) => {
  expect(mergeWinScore(score, condition)).toBe(expected);
});

test.each([NaN, Infinity, -1, 11])('rejects invalid score %s', (value) => {
  expect(() => mergeWinScore(value, 0)).toThrow('invalid_score');
});

test('keeps placeholder states unknown, even when their numeric value is 5', () => {
  const catalog = fixture();
  catalog.values = [state('score', 5, 0), state('condition', 5, 0)];
  const row = buildWinMergePreview(catalog).rows.find((item) => item.subjectId === 'other')!;
  expect(row.merged).toBeNull();
  expect(row.sourceScore?.score).toBe(5);
  catalog.values[1] = state('condition', 0);
  expect(buildWinMergePreview(catalog).rows.at(-1)?.merged).toBe(0);
});

test('retains legacy evidence and comparison-only evidence', () => {
  const catalog = fixture();
  catalog.values = [{ ...state('score', 8), evidenceCount: undefined }, { ...state('condition', 6), directCount: 0, comparisonCount: 1 }];
  expect(buildWinMergePreview(catalog).rows.at(-1)?.merged).toBe(4);
});

test('corrects exactly five IDs, keeps source states and author text unchanged, separates pending sources', () => {
  const catalog = fixture();
  catalog.values = [state('score', 3), state('condition', 8)];
  catalog.candidates = [{ id: 'candidate', displayName: '花火', values: [10, 3], matchStatus: 'pending', sourceRowNumber: 1 }];
  const before = JSON.stringify(catalog);
  const preview = buildWinMergePreview(catalog);
  expect(preview.rows.filter((row) => row.corrected).map((row) => row.merged)).toEqual([9, 10, 8, 10, 2]);
  expect(preview.rows.at(-1)?.merged).toBe(7.5);
  expect(preview.rows.at(-1)?.sourceScore).toBe(catalog.values[0]);
  expect(preview.pendingCandidates[0].merged).toBe(1.5);
  expect(renderWinMergePreview(preview, 'test', 'local')).toContain(catalog.attributes[0].fullDescription);
  expect(JSON.stringify(catalog)).toBe(before);
});

test('fails closed if correction targets or source attributes disappear or duplicate scores appear', () => {
  const catalog = fixture();
  catalog.subjects.shift();
  expect(() => buildWinMergePreview(catalog)).toThrow('correction_targets_missing');
  const missing = fixture();
  missing.attributes.pop();
  expect(() => buildWinMergePreview(missing)).toThrow('source_attributes_missing');
  const duplicate = fixture();
  duplicate.values = [state('score', 3), state('score', 4)];
  expect(() => buildWinMergePreview(duplicate)).toThrow('duplicate_value');
});

test('checked-in preview is reproducible from its retained source states', () => {
  const saved = JSON.parse(readFileSync('docs/attribute-win-merge-preview-2026-09-08.json', 'utf8')) as ReturnType<typeof buildWinMergePreview> & { source: string; fetchedAt: string };
  expect(saved.pendingCandidates).toHaveLength(0);
  const replay = buildWinMergePreview({
    generation: saved.generation, throughVersion: saved.throughVersion, generatedAt: saved.snapshotGeneratedAt,
    attributes: [saved.scoreAttribute, saved.conditionAttribute],
    subjects: saved.rows.map((row) => ({ id: row.subjectId, slug: row.subjectId, displayName: row.name, kind: row.kind })),
    values: saved.rows.flatMap((row) => [row.sourceScore, row.sourceCondition].filter((item): item is AttributeMatrixValue => item !== null)),
    activities: [], candidates: [],
  });
  expect(replay.rows).toEqual(saved.rows);
  expect(renderWinMergePreview(replay, saved.fetchedAt, saved.source).trimEnd()).toBe(readFileSync('docs/attribute-win-merge-preview-2026-09-08.md', 'utf8').trimEnd());
});
