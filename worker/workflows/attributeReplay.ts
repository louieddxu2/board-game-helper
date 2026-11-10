import type { Database } from '../data/database';
import { prepareAttributeReplay } from '../data/attributeReplay';
import { acquireAttributeReplayLock, commitAttributeReplay, releaseAttributeReplayLock } from '../data/attributeLocks';
import { ATTRIBUTE_SCORE_MODEL_VERSION } from '../data/attributeScoring';
import { prepareAttributeCatalogSnapshot } from '../data/attributeCatalog';

export interface AttributeReplayStatus {
  required_revision: number;
  replayed_revision: number;
  replayed_model_version: string | null;
}

interface AttributeReplayOptions {
  maxChunkBytes?: number;
  maxReplayChunkBytes?: number;
}

export const queryAttributeReplayStatus = (db: Database) => db.statement(`
  SELECT required_revision, replayed_revision, replayed_model_version
  FROM attribute_replay_status WHERE id = 1
`).first<AttributeReplayStatus>();

/** Caller holds the replay lock for calculation, publication and acknowledgement. */
export const publishCompleteAttributeReplayLocked = async (
  db: Database,
  lock: Awaited<ReturnType<typeof acquireAttributeReplayLock>>,
  timestamp: number,
  requiredRevision: number,
  options: AttributeReplayOptions = {},
): Promise<void> => {
  const replay = await prepareAttributeReplay(db, timestamp, options.maxReplayChunkBytes);
  const snapshot = prepareAttributeCatalogSnapshot(
    db, replay.catalogPayload, replay.catalogThroughVersion, timestamp, options,
  );
  const acknowledge = db.statement(`
    INSERT INTO attribute_replay_status
      (id, required_revision, replayed_revision, replayed_model_version)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      replayed_revision = excluded.replayed_revision,
      replayed_model_version = excluded.replayed_model_version
    WHERE attribute_replay_status.replayed_revision <> excluded.replayed_revision
      OR attribute_replay_status.replayed_model_version IS NOT excluded.replayed_model_version
  `).bind(requiredRevision, requiredRevision, ATTRIBUTE_SCORE_MODEL_VERSION);
  await commitAttributeReplay(db, lock, [
    ...replay.statements,
    ...snapshot,
    acknowledge,
  ], requiredRevision);
};

/** Recalculate attributes from raw votes, then publish their fresh snapshot. */
export const runCompleteAttributeReplay = async (
  db: Database,
  timestamp = Date.now(),
  options: AttributeReplayOptions = {},
): Promise<void> => {
  const lock = await acquireAttributeReplayLock(db, timestamp);
  try {
    const status = await queryAttributeReplayStatus(db);
    await publishCompleteAttributeReplayLocked(db, lock, timestamp, status?.required_revision ?? 0, options);
  } finally {
    await releaseAttributeReplayLock(db, lock);
  }
};
