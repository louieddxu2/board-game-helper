// Research only. Production Worker code does not import this module.
import type { AttributeMatrixValue } from '../src/shared/types';
import type { Database } from '../worker/data/database';

export interface PrototypeCatalogEntry { entryKey: string; entryJson: string; }

/** Caller includes every statement in its existing score/progress transaction. */
export const preparePrototypePublication = (db: Database, entries: PrototypeCatalogEntry[]) => {
  if (!entries.length) return [];
  const timestamp = Date.now();
  return [
    db.statement('UPDATE attribute_catalog_clock SET current_version = current_version + ? WHERE id = 1').bind(entries.length),
    db.statement(`INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
      SELECT item.value ->> 0, clock.current_version - ? + CAST(item.key AS INTEGER) + 1,
        item.value ->> 1, 0, ?
      FROM attribute_catalog_clock clock CROSS JOIN json_each(?) item WHERE clock.id = 1
      ON CONFLICT(entry_key) DO UPDATE SET catalog_version = excluded.catalog_version,
        entry_json = excluded.entry_json, deleted = excluded.deleted, updated_at = excluded.updated_at`)
      .bind(entries.length, timestamp, JSON.stringify(entries.map((entry) => [entry.entryKey, entry.entryJson]))),
  ];
};

export const preparePrototypeScorePublication = (db: Database, values: AttributeMatrixValue[]) =>
  preparePrototypePublication(db, values.map((value) => ({
    entryKey: `value:${value.subjectId}:${value.attributeId}`, entryJson: JSON.stringify({ kind: 'value', ...value }),
  })));

/** Metadata publication must reject a bundle read before a newer score delta. */
export const publishPrototypeSubjectBundle = async (db: Database, input: {
  expectedVersion: number; expectedGeneration: number | null; subjectId: string; expectedRevision: number; entryJson: string;
}) => db.batch([
  db.statement(`SELECT json_extract('{}', CASE WHEN (
    SELECT current_version FROM attribute_catalog_clock WHERE id = 1
  ) = ? AND (SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1) IS ?
    AND EXISTS (SELECT 1 FROM catalog_change_outbox
    WHERE catalog = 'attribute-subject' AND entity_key = ? AND revision = ?)
    THEN '$' ELSE 'prototype_publication_changed' END)`)
    .bind(input.expectedVersion, input.expectedGeneration, input.subjectId, input.expectedRevision),
  ...preparePrototypePublication(db, [{ entryKey: `subject:${input.subjectId}`, entryJson: input.entryJson }]),
  db.statement(`DELETE FROM catalog_change_outbox
    WHERE catalog = 'attribute-subject' AND entity_key = ? AND revision = ?`).bind(input.subjectId, input.expectedRevision),
]);
