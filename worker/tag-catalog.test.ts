import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import { publicTagCatalogChangesPayload, queryPublicTagCatalogChanges } from './data/tagCatalog';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

describe('versioned public tag catalog', () => {
  test('reads only catalog versions newer than the client cursor without joining source tables', async () => {
    const all = vi.fn().mockResolvedValue({ results: [{
      tag_id: 'tag_draw', catalog_version: 8,
      entry_json: JSON.stringify({ id: 'tag_draw', slug: 'draw', name: '抽牌', aliases: ['補牌'], isPublic: true, updatedAt: 10 }),
      deleted: 0,
    }], meta: { rows_read: 1 } });
    const prepared = statement({ all });
    const db = { statement: vi.fn().mockReturnValue(prepared), batch: vi.fn() } as unknown as Database;

    const result = await queryPublicTagCatalogChanges(db, 7);
    const payload = publicTagCatalogChangesPayload(result, 7);
    const sql = String(vi.mocked(db.statement).mock.calls[0][0]);

    expect(sql).toMatch(/public_tag_catalog_entries/);
    expect(sql).toMatch(/catalog_version > \?/);
    expect(sql).not.toMatch(/\b(?:tags|tag_aliases)\b/);
    expect(prepared.bind).toHaveBeenCalledWith(7, 1000);
    expect(payload).toEqual({
      changes: [{ tagId: 'tag_draw', catalogVersion: 8, deleted: false, tag: expect.objectContaining({ name: '抽牌', aliases: ['補牌'] }) }],
      throughVersion: 8,
      hasMore: false,
    });
  });

  test('keeps one tombstone change when a public tag is removed', () => {
    expect(publicTagCatalogChangesPayload({ results: [{
      tag_id: 'tag_old', catalog_version: 9, entry_json: null, deleted: 1,
    }] }, 8).changes).toEqual([
      { tagId: 'tag_old', catalogVersion: 9, deleted: true, tag: undefined },
    ]);
  });
});
