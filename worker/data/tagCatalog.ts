import type { PublicTagCatalogChange, PublicTagCatalogChangesPayload, TagSummary } from '../../src/shared/types';
import type { Database, D1Result } from './database';

interface PublicTagCatalogEntryRow {
  tag_id: string;
  catalog_version: number;
  entry_json: string | null;
  deleted: number;
}

const parseTagSummary = (value: string): TagSummary => {
  const parsed = JSON.parse(value) as TagSummary;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') throw new Error('invalid_public_tag_catalog_entry');
  return parsed;
};

export const queryPublicTagCatalogChanges = (
  db: Database,
  afterVersion: number,
  limit = 1000,
): Promise<D1Result<PublicTagCatalogEntryRow>> => db.statement(`
  SELECT tag_id, catalog_version, entry_json, deleted
  FROM public_tag_catalog_entries
  WHERE catalog_version > ?
  ORDER BY catalog_version, tag_id
  LIMIT ?
`).bind(afterVersion, limit).all<PublicTagCatalogEntryRow>();

export const publicTagCatalogChangesPayload = (
  result: D1Result<PublicTagCatalogEntryRow>,
  afterVersion: number,
  limit = 1000,
): PublicTagCatalogChangesPayload => {
  const rows = result.results ?? [];
  const changes: PublicTagCatalogChange[] = rows.map((row) => ({
    tagId: row.tag_id,
    catalogVersion: Number(row.catalog_version),
    deleted: Boolean(row.deleted),
    tag: row.deleted || !row.entry_json ? undefined : parseTagSummary(row.entry_json),
  }));
  return {
    changes,
    throughVersion: changes.at(-1)?.catalogVersion ?? afterVersion,
    hasMore: rows.length === limit,
  };
};
