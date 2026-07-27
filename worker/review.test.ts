import { describe, expect, test } from 'vitest';
import { normalizedReviewContent, reviewContentHash, reviewFileSchema, sameReviewContent, type ReviewFile } from './review';
import { parseReviewCsv, serializeReviewCsv } from './review-csv';

const file: ReviewFile = {
  format: 'wrong-board-game-rules-review',
  schemaVersion: 1,
  name: '手機帝國校稿',
  exportedAt: 1_700_000_000_000,
  datasetVersion: 'dataset-1',
  scope: { gameIds: ['game-1'], missingSource: true },
  instructions: ['只修改 proposed。'],
  items: [{
    action: 'propose',
    target: {
      type: 'rule',
      id: 'rule-1',
      gameId: 'game-1',
      gameName: '手機帝國',
      gameSlug: 'smartphone-inc',
    },
    base: { updatedAt: 123, contentHash: 'a'.repeat(64) },
    current: {
      statement: '舊規則，含有逗號\n與換行',
      commonMistake: null,
      details: null,
      flowStage: 'action',
      playerCounts: [],
      editionNotes: [],
      editionNote: null,
      sourceLabel: null,
      sourceUrl: null,
      tagNames: ['銷售'],
    },
    proposed: {
      statement: '新規則，含有逗號\n與換行',
      commonMistake: '任意選擇',
      details: null,
      flowStage: 'action',
      playerCounts: [],
      editionNotes: [],
      editionNote: null,
      sourceLabel: '規則書',
      sourceUrl: 'https://example.com/rules',
      tagNames: ['銷售', '時機'],
    },
    reason: '修正結算順序',
  }],
};

describe('review exchange files', () => {
  test('normalizes equivalent content and creates stable hashes', async () => {
    const normalized = normalizedReviewContent({
      ...file.items[0].proposed,
      statement: '  新規則，含有逗號\n與換行  ',
      tagNames: ['#銷售', '銷售', ' 時機 '],
    });
    expect(normalized.tagNames).toEqual(['銷售', '時機']);
    expect(sameReviewContent(normalized, file.items[0].proposed)).toBe(true);
    expect(await reviewContentHash(normalized)).toBe(await reviewContentHash(file.items[0].proposed));
  });

  test('round-trips an editable CSV including commas and newlines', () => {
    const parsed = parseReviewCsv(serializeReviewCsv(file));
    const validated = reviewFileSchema.parse(parsed);
    expect({ ...validated, instructions: file.instructions }).toEqual(file);
  });

  test('rejects a CSV whose protected base hash is missing', () => {
    const csv = serializeReviewCsv(file).replace('a'.repeat(64), '');
    expect(() => parseReviewCsv(csv)).toThrow();
  });

  test('neutralizes spreadsheet formulas without changing imported text', () => {
    const formulaFile = structuredClone(file);
    formulaFile.items[0].proposed.statement = '=HYPERLINK("https://example.com")';
    const csv = serializeReviewCsv(formulaFile);
    expect(csv).toContain('\t=HYPERLINK');
    expect(parseReviewCsv(csv).items[0].proposed.statement).toBe('=HYPERLINK("https://example.com")');
  });
});
