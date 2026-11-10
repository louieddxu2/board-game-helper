import { applyAttributeCatalogChanges } from '../../src/lib/attributeCatalog';
import type { AttributeCatalogPayload } from '../../src/shared/types';
import {
  attributeCatalogChangesPayload,
  attributeCatalogPayload,
  prepareAttributeCatalogSnapshot,
  queryAttributeCatalogChanges,
  queryAttributeCatalogSnapshot,
} from '../data/attributeCatalog';
import { acquireAttributeReplayLock, commitAttributeReplay, releaseAttributeReplayLock } from '../data/attributeLocks';
import { ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE, queryAttributeReplayWork, queryReplayHistoryHead } from '../data/attributeReplayWork';
import { ATTRIBUTE_SCORE_MODEL_VERSION } from '../data/attributeScoring';
import type { Database } from '../data/database';
import { publishCompleteAttributeReplayLocked, queryAttributeReplayStatus } from './attributeReplay';
import { runAttributeReplayWorkLocked, type ReplayWorkBudget } from './attributeResumableReplay';

const sameIds = (before: Array<{ id: string }>, after: Array<{ id: string }>) => {
  const ids = new Set(before.map((item) => item.id));
  return ids.size === after.length && after.every((item) => ids.has(item.id));
};

const updatedCatalogFromSnapshot = async (db: Database): Promise<AttributeCatalogPayload | null> => {
  // Capture the publication boundary before checking pending work. Otherwise
  // a version reserved by an unfinished publication could enter our cursor.
  const clock = await db.statement('SELECT current_version FROM attribute_catalog_clock WHERE id = 1')
    .first<{ current_version: number }>();
  if (!clock) throw new Error('attribute_catalog_clock_unavailable');
  const pending = await db.statement(`
    SELECT entity_key FROM catalog_change_outbox
    WHERE catalog IN ('attribute-subject', 'attribute-definition', 'attribute-candidate')
    LIMIT 1
  `).first();
  if (pending) return null;
  const snapshot = await queryAttributeCatalogSnapshot(db);
  if (!snapshot.state.results?.length) return null;
  let baseline: AttributeCatalogPayload;
  try {
    baseline = attributeCatalogPayload(snapshot);
  } catch (error) {
    if (error instanceof Error && [
      'incomplete_attribute_catalog_snapshot', 'invalid_attribute_catalog_chunk', 'invalid_attribute_catalog_attributes',
    ].includes(error.message)) return null;
    throw error;
  }
  if (baseline.scoreModelVersion !== ATTRIBUTE_SCORE_MODEL_VERSION) return null;
  let current = baseline;
  while (current.throughVersion < clock.current_version) {
    const result = await queryAttributeCatalogChanges(db, current.throughVersion);
    // Later publications remain deltas for the next snapshot/browser sync.
    const rows = (result.results ?? []).filter((row) => row.catalog_version <= clock.current_version);
    if (!rows.length) break;
    const changes = attributeCatalogChangesPayload({ ...result, results: rows }, current.throughVersion, {
      generation: baseline.generation, generatedAt: baseline.generatedAt,
    });
    current = applyAttributeCatalogChanges(current, changes.changes, changes.throughVersion);
    if (!changes.hasMore) break;
  }
  // A changed voting pool can reintroduce old votes whose states were retired.
  // Recalculate it from history instead of retaining missing/default values.
  if (!sameIds(baseline.subjects, current.subjects) || !sameIds(baseline.attributes, current.attributes)) return null;
  return current;
};

/** Weekly refresh; manual full replay remains a separate, unconditional action. */
export const runWeeklyAttributeRebuild = async (
  db: Database,
  timestamp = Date.now(),
  options: { maxChunkBytes?: number; workBudget?: ReplayWorkBudget } = {},
): Promise<'replay' | 'cache' | 'pending'> => {
  const lock = await acquireAttributeReplayLock(db, timestamp);
  try {
    const status = await queryAttributeReplayStatus(db);
    const revision = status?.required_revision ?? 0;
    const budget = options.workBudget;
    const work = budget ? await queryAttributeReplayWork(db) : null;
    if (budget && work) return await runAttributeReplayWorkLocked(db, lock, timestamp, status, work, budget);
    const needsReplay = !status || status.required_revision !== status.replayed_revision
      || status.replayed_model_version !== ATTRIBUTE_SCORE_MODEL_VERSION;
    const catalog = needsReplay ? null : await updatedCatalogFromSnapshot(db);
    if (catalog) {
      const snapshot = prepareAttributeCatalogSnapshot(db, catalog, catalog.throughVersion, timestamp, options);
      await commitAttributeReplay(db, lock, snapshot, revision);
      return 'cache';
    }
    if (budget) {
      const head = await queryReplayHistoryHead(db);
      if (head.rowid >= (budget.minimumHistoryRowid ?? ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE)) {
        return await runAttributeReplayWorkLocked(db, lock, timestamp, status, null, budget, head);
      }
    }
    await publishCompleteAttributeReplayLocked(db, lock, timestamp, status, options);
    return 'replay';
  } finally {
    await releaseAttributeReplayLock(db, lock);
  }
};
