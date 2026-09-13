import type { Database } from '../data/database';
import { replayAllAttributeScores } from '../data/attributes';
import { rebuildAttributeCatalog } from '../data/attributeCatalog';

/** Recalculate attributes from raw votes, then publish their fresh snapshot. */
export const runCompleteAttributeReplay = async (db: Database, timestamp = Date.now()): Promise<void> => {
  await replayAllAttributeScores(db, timestamp);
  await rebuildAttributeCatalog(db, timestamp);
};
