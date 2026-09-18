import type { Database } from '../data/database';
import { replayAllAttributeScores } from '../data/attributes';
import { publishAttributeCatalogSnapshot } from '../data/attributeCatalog';

/** Recalculate attributes from raw votes, then publish their fresh snapshot. */
export const runCompleteAttributeReplay = async (
  db: Database,
  timestamp = Date.now(),
  options: { maxChunkBytes?: number } = {},
): Promise<void> => {
  const replay = await replayAllAttributeScores(db, timestamp);
  // A full replay is the authoritative reconciliation boundary.  Always
  // publish its newly computed browser snapshot, even when the numerical
  // state happens to compare equal to the prior checkpoint.
  await publishAttributeCatalogSnapshot(
    db, replay.catalogPayload, replay.catalogThroughVersion, timestamp, options,
  );
};
