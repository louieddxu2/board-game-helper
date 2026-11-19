import type { AttributeMatrixValue } from '../../src/shared/types';
import type { Database } from './database';

export interface AttributePublicationEntry {
  entryKey: string;
  entryJson: string | null;
  deleted: boolean;
  updatedAt: number;
}

export interface AttributePublicationFence {
  version: number;
  generation: number | null;
}

export interface AttributePublicationJob { entity_key: string; revision: number; }

/** Read before expanding source rows. A replay can change generation alone. */
export const queryAttributePublicationFence = (db: Database) => db.statement(`
  SELECT current_version AS version,
    (SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1) AS generation
  FROM attribute_catalog_clock WHERE id = 1
`).first<AttributePublicationFence>();

/** Caller commits the reservation, entries and its source/ack in one batch. */
export const prepareAttributeCatalogEntries = (db: Database, entries: AttributePublicationEntry[]) => {
  if (!entries.length) return [];
  return [
    db.statement('UPDATE attribute_catalog_clock SET current_version = current_version + ? WHERE id = 1').bind(entries.length),
    db.statement(`INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
      SELECT item.value ->> 0, clock.current_version - ? + CAST(item.key AS INTEGER) + 1,
        item.value ->> 1, item.value ->> 2, item.value ->> 3
      FROM attribute_catalog_clock clock CROSS JOIN json_each(?) item WHERE clock.id = 1
      ON CONFLICT(entry_key) DO UPDATE SET catalog_version = excluded.catalog_version,
        entry_json = excluded.entry_json, deleted = excluded.deleted, updated_at = excluded.updated_at`)
      .bind(entries.length, JSON.stringify(entries.map((entry) =>
        [entry.entryKey, entry.entryJson, entry.deleted ? 1 : 0, entry.updatedAt]))),
  ];
};

export const prepareAttributeScorePublication = (db: Database, values: AttributeMatrixValue[], timestamp = Date.now()) =>
  prepareAttributeCatalogEntries(db, values.map((value) => ({
    entryKey: `value:${value.subjectId}:${value.attributeId}`,
    entryJson: JSON.stringify({ kind: 'value', ...value }), deleted: false, updatedAt: timestamp,
  })));

/** A stale publisher leaves every job intact; a later flush rereads its source. */
export const publishAttributeCatalogJobs = async (
  db: Database, catalog: string, jobs: AttributePublicationJob[],
  fence: AttributePublicationFence, entries: AttributePublicationEntry[],
): Promise<boolean> => {
  if (!jobs.length) return true;
  const source = JSON.stringify(jobs.map((job) => [job.entity_key, job.revision]));
  try {
    await db.batch([
      db.statement(`SELECT json_extract('{}', CASE WHEN
        (SELECT current_version FROM attribute_catalog_clock WHERE id = 1) = ?
        AND (SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1) IS ?
        AND NOT EXISTS (SELECT 1 FROM json_each(?) job WHERE NOT EXISTS (
          SELECT 1 FROM catalog_change_outbox pending
          WHERE pending.catalog = ? AND pending.entity_key = job.value ->> 0 AND pending.revision = job.value ->> 1
        )) THEN '$' ELSE 'attribute_catalog_publication_changed' END)`)
        .bind(fence.version, fence.generation, source, catalog),
      ...prepareAttributeCatalogEntries(db, entries),
      db.statement(`DELETE FROM catalog_change_outbox WHERE catalog = ? AND (entity_key, revision) IN (
        SELECT value ->> 0, value ->> 1 FROM json_each(?)
      )`).bind(catalog, source),
    ]);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('attribute_catalog_publication_changed')) return false;
    throw error;
  }
};
