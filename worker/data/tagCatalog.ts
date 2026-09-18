import type { PublicTagCatalogChange, PublicTagCatalogChangesPayload, TagSummary } from '../../src/shared/types';
import type { Database, D1Result } from './database';

interface PublicTagCatalogEntryRow {
  tag_id: string;
  catalog_version: number;
  entry_json: string | null;
  deleted: number;
}

export interface TargetedPublicTagCatalogEntry {
  tagId: string;
  deleted: boolean;
  tag?: TagSummary;
  updatedAt: number;
}

const parseTagSummary = (value: string): TagSummary => {
  const parsed = JSON.parse(value) as TagSummary;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') throw new Error('invalid_public_tag_catalog_entry');
  return parsed;
};

/** A point lookup for the explicit catalog publisher. */
export const queryTargetedPublicTagCatalogEntries = async (
  db: Database,
  tagIds: string[],
): Promise<TargetedPublicTagCatalogEntry[]> => {
  if (!tagIds.length) return [];
  const result = await db.statement(`
    SELECT t.id, t.slug, t.name, t.updated_at,
      COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = t.id ORDER BY alias)
      ), '[]') AS aliases_json
    FROM tags t
    WHERE t.id IN (${tagIds.map(() => '?').join(',')})
      AND t.status = 'active'
      AND t.is_public = 1
  `).bind(...tagIds).all<{ id: string; slug: string; name: string; updated_at: number; aliases_json: string }>();
  return (result.results ?? []).map((row) => ({
    tagId: row.id,
    deleted: false,
    tag: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      isPublic: true,
      updatedAt: Number(row.updated_at),
      aliases: JSON.parse(row.aliases_json) as string[],
    },
    updatedAt: Number(row.updated_at),
  }));
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
