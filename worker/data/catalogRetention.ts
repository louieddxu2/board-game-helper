import type { Database } from './database';

/**
 * A browser can only apply deltas on top of the snapshot generation it
 * already holds.  Once a weekly attribute snapshot includes a version, its
 * corresponding delta is redundant and may be discarded.  Keep this small
 * so retention never becomes a quota spike after a large import.
 */
export const ATTRIBUTE_CATALOG_DELTA_PRUNE_LIMIT = 100;

/**
 * Remove one bounded page of attribute catalog entries already represented
 * by the active snapshot.  Newer entries remain available for browser
 * synchronization, and an absent snapshot makes this a no-op.
 */
export const cleanupAttributeCatalogDeltas = async (
  db: Database,
  limit = ATTRIBUTE_CATALOG_DELTA_PRUNE_LIMIT,
): Promise<void> => {
  const pageSize = Math.max(1, Math.min(ATTRIBUTE_CATALOG_DELTA_PRUNE_LIMIT, Math.floor(limit)));
  await db.statement(`
    DELETE FROM attribute_catalog_entries
    WHERE catalog_version IN (
      SELECT catalog_version
      FROM attribute_catalog_entries
      WHERE catalog_version <= (
        SELECT through_version
        FROM attribute_catalog_snapshot_state
        WHERE id = 1
      )
      ORDER BY catalog_version
      LIMIT ?
    )
  `).bind(pageSize).run();
};
