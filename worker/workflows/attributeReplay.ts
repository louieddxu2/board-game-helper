import type { Database } from '../data/database';
import { replayAllAttributeScores } from '../data/attributes';
import { rebuildAttributeCatalog } from '../data/attributeCatalog';

/** Recalculate attributes from raw votes, then publish their fresh snapshot. */
export const runCompleteAttributeReplay = async (db: Database, timestamp = Date.now()): Promise<void> => {
  const changed = await replayAllAttributeScores(db, timestamp);
  // A replay that reaches the same materialized state already has a current
  // cache. Avoid rewriting snapshot chunks merely because the weekly clock ran.
  if (changed) await rebuildAttributeCatalog(db, timestamp);
};
