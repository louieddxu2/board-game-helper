import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import {
  ATTRIBUTE_CATALOG_CHANGE_LIMIT,
  attributeCatalogChangesPayload,
  attributeCatalogPayload,
  chunkAttributeCatalog,
  queryAttributeCatalogChanges,
} from './data/attributeCatalog';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

const subject = (id = 'subject-a') => ({
  id,
  slug: `game-${id}`,
  kind: 'game' as const,
  displayName: `遊戲 ${id}`,
  gameId: id,
  gameSlug: `game-${id}`,
  components: [],
});

const value = (subjectId = 'subject-a') => ({
  subjectId,
  attributeId: 'attribute-luck',
  score: 6.5,
  ratingDeviation: 2.2,
  directAverage: 7,
  directCount: 1,
  comparisonCount: 2,
  decisiveComparisonCount: 1,
  evidenceCount: 3,
  modelVersion: 'glicko-rd-v1',
});

describe('versioned attribute table catalog', () => {
  test('hydrates subjects, score values, and pending candidates from snapshot chunks', () => {
    const query = {
      state: { results: [{ active_generation: 4, through_version: 9, chunk_count: 1, attributes_json: JSON.stringify([{ id: 'attribute-luck', key: 'luck', name: '運氣', minValue: 0, maxValue: 10, sortOrder: 0 }]), score_model_version: 'glicko-rd-v1', generated_at: 123 }] },
      chunks: { results: [{ chunk_number: 0, entries_json: JSON.stringify([
        { kind: 'subject', subject: subject(), values: [value()] },
        { kind: 'candidate', candidate: { id: 'candidate-1', displayName: '待處理', values: [8], matchStatus: 'pending', sourceRowNumber: 3 } },
      ]) }] },
    };

    expect(attributeCatalogPayload(query)).toMatchObject({
      generation: 4,
      throughVersion: 9,
      subjects: [expect.objectContaining({ id: 'subject-a' })],
      values: [expect.objectContaining({ score: 6.5 })],
      candidates: [expect.objectContaining({ id: 'candidate-1' })],
    });
  });

  test('queries only catalog entries newer than the client cursor', async () => {
    const prepared = statement({ all: vi.fn().mockResolvedValue({ results: [], meta: { rows_read: 0 } }) });
    const db = { statement: vi.fn().mockReturnValue(prepared), batch: vi.fn() } as unknown as Database;

    await queryAttributeCatalogChanges(db, 12, 32);

    expect(db.statement).toHaveBeenCalledWith(expect.stringMatching(/catalog_version > \?/));
    expect(prepared.bind).toHaveBeenCalledWith(12, 32);
  });

  test('keeps the default change page below the product row budget', async () => {
    const prepared = statement({ all: vi.fn().mockResolvedValue({ results: [] }) });
    const db = { statement: vi.fn().mockReturnValue(prepared), batch: vi.fn() } as unknown as Database;

    await queryAttributeCatalogChanges(db, 12);

    expect(ATTRIBUTE_CATALOG_CHANGE_LIMIT).toBeLessThan(100);
    expect(prepared.bind).toHaveBeenCalledWith(12, ATTRIBUTE_CATALOG_CHANGE_LIMIT);
  });

  test('decodes value, subject, candidate, and deletion deltas', () => {
    const payload = attributeCatalogChangesPayload({ results: [
      { entry_key: 'subject:subject-a', catalog_version: 13, entry_json: JSON.stringify({ kind: 'subject', subject: subject() }), deleted: 0 },
      { entry_key: 'value:subject-a:attribute-luck', catalog_version: 14, entry_json: JSON.stringify({ kind: 'value', ...value(), subject: subject() }), deleted: 0 },
      { entry_key: 'attribute:attribute-luck', catalog_version: 15, entry_json: JSON.stringify({ kind: 'attribute', attribute: { id: 'attribute-luck', key: 'luck', name: '運氣', minValue: 0, maxValue: 10, sortOrder: 0 } }), deleted: 0 },
      { entry_key: 'candidate:candidate-1', catalog_version: 16, entry_json: JSON.stringify({ kind: 'candidate', id: 'candidate-1', displayName: '待處理', valuesJson: JSON.stringify([8]), matchStatus: 'pending', sourceRowNumber: 3 }), deleted: 0 },
      { entry_key: 'value:subject-b:attribute-luck', catalog_version: 17, entry_json: null, deleted: 1 },
    ] }, 12);

    expect(payload.throughVersion).toBe(17);
    expect(payload.changes).toHaveLength(5);
    expect(payload.changes[0]).toMatchObject({ entryKey: 'subject:subject-a', subject: expect.objectContaining({ id: 'subject-a' }) });
    expect(payload.changes[1]).toMatchObject({ value: expect.objectContaining({ score: 6.5 }), subject: expect.objectContaining({ id: 'subject-a' }) });
    expect(payload.changes[2]).toMatchObject({ attribute: expect.objectContaining({ id: 'attribute-luck' }) });
    expect(payload.changes[3]).toMatchObject({ candidate: expect.objectContaining({ id: 'candidate-1', values: [8] }) });
    expect(payload.changes[4]).toMatchObject({ deleted: true });
  });

  test('chunks large snapshots without relying on the number of games', () => {
    const chunks = chunkAttributeCatalog(Array.from({ length: 2501 }, (_, index) => ({
      kind: 'subject' as const,
      subject: subject(`subject-${index}`),
      values: [],
    })));

    expect(chunks.map((chunk) => chunk.length)).toEqual([1000, 1000, 501]);
  });
});
