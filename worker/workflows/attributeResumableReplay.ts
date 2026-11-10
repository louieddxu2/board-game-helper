import { acquireAttributeReplayLock, commitAttributeReplay, releaseAttributeReplayLock, type AttributeReplayLock } from '../data/attributeLocks';
import { prepareCalculatedAttributeReplay, queryFullReplayMetadata } from '../data/attributeReplay';
import { queryOrderedCalculationInProgress } from '../data/attributeReplayOrdering';
import {
  assertReplayCatalogVersion, assertReplayHistoryHead, ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE, prepareCalculateReplayAttribute, prepareCaptureReplayHistory,
  prepareCatchUpOnlineReplay, prepareClearReplayWork, prepareDeferDirectRatings, prepareExtendReplayWork, prepareStartReplayWork,
  queryAttributeReplayWork, queryCalculatedReplayWork, queryCompletedReplayAttributes, queryReplayAnchorMatches,
  queryReplayCatalogPending, queryReplayHasNewDirectRating, queryReplayHistoryHead, queryReplayHistoryRevision,
  type ReplayHistoryHead, type ReplayScope, type ReplayWork,
} from '../data/attributeReplayWork';
import { ATTRIBUTE_SCORE_MODEL_VERSION } from '../data/attributeScoring';
import type { Database } from '../data/database';
import { publishPreparedAttributeReplay, queryAttributeReplayStatus, type AttributeReplayStatus } from './attributeReplay';

export interface ReplayWorkBudget {
  maxSteps?: number;
  pageSize?: number;
  minimumHistoryRowid?: number;
}

export type ResumableReplayOutcome = 'pending' | 'replay';

const MAX_REPLAY_STEPS_PER_RUN = 128;
const MAX_REPLAY_STATEMENTS_PER_RUN = 700;
const REPLAY_RUN_BUDGET_MS = 20_000;

const replayScope = (metadata: Awaited<ReturnType<typeof queryFullReplayMetadata>>): ReplayScope =>
  [[...metadata.subjectIds].sort(), [...metadata.attributes.keys()].sort()];

const startReplayWork = async (
  db: Database, lock: AttributeReplayLock, revision: number, historyRevision: number, head: ReplayHistoryHead, scope: ReplayScope,
): Promise<ReplayWork> => {
  const work: ReplayWork = {
    history_revision: historyRevision, input_revision: revision, model_version: ATTRIBUTE_SCORE_MODEL_VERSION, scope_json: JSON.stringify(scope),
    target_rowid: head.rowid, target_response_id: head.response_id, scanned_rowid: 0, online_rowid: null, online_response_id: null,
  };
  await commitAttributeReplay(db, lock, prepareStartReplayWork(db, work), revision);
  return work;
};

const extendReplayWork = async (db: Database, lock: AttributeReplayLock, work: ReplayWork, head: ReplayHistoryHead, revision: number) => {
  if (await queryReplayHasNewDirectRating(db, work.target_rowid, head.rowid)) {
    await commitAttributeReplay(db, lock, [prepareDeferDirectRatings(db, work)], revision);
    work.online_rowid = work.target_rowid;
    work.online_response_id = work.target_response_id;
    return;
  }
  await commitAttributeReplay(db, lock, [prepareExtendReplayWork(db, head)], revision);
  work.target_rowid = head.rowid;
  work.target_response_id = head.response_id;
};

export const runAttributeReplayWorkLocked = async (
  db: Database,
  lock: AttributeReplayLock,
  timestamp: number,
  status: AttributeReplayStatus | null,
  existing: ReplayWork | null,
  budget: ReplayWorkBudget,
  initialHead?: ReplayHistoryHead,
): Promise<ResumableReplayOutcome> => {
  const startedAt = Date.now();
  const initialQueries = db.metrics?.().queries ?? 0;
  const revision = status?.required_revision ?? 0;
  const [historyRevision, currentHead] = await Promise.all([
    queryReplayHistoryRevision(db), initialHead ?? queryReplayHistoryHead(db),
  ]);
  let work = existing;
  if (!work || work.input_revision == null || (status?.replayed_revision ?? 0) > work.input_revision
    || work.history_revision !== historyRevision || work.model_version !== ATTRIBUTE_SCORE_MODEL_VERSION
    || !await queryReplayAnchorMatches(db, work)) {
    const metadata = await queryFullReplayMetadata(db);
    work = await startReplayWork(db, lock, revision, historyRevision, currentHead, replayScope(metadata));
  } else if (work.online_rowid == null && currentHead.rowid > work.target_rowid && !await queryOrderedCalculationInProgress(db)) {
    await extendReplayWork(db, lock, work, currentHead, revision);
  }
  let scope = JSON.parse(work.scope_json) as ReplayScope;
  const completed = await queryCompletedReplayAttributes(db);
  const maxSteps = budget.maxSteps ?? MAX_REPLAY_STEPS_PER_RUN;
  const pageSize = budget.pageSize ?? ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE;
  for (let step = 0; step < maxSteps; step += 1) {
    if (step > 0 && (Date.now() - startedAt >= REPLAY_RUN_BUDGET_MS
      || (db.metrics?.().queries ?? 0) - initialQueries >= MAX_REPLAY_STATEMENTS_PER_RUN)) return 'pending';
    if (work.scanned_rowid < work.target_rowid) {
      const { cursor, statements, invalidated } = await prepareCaptureReplayHistory(db, work, scope, completed, pageSize);
      await commitAttributeReplay(db, lock, statements, revision);
      work.scanned_rowid = cursor;
      invalidated.forEach((attributeId) => completed.delete(attributeId));
      continue;
    }

    const attributeId = scope[1].find((id) => !completed.has(id));
    if (attributeId) {
      const { completed: attributeCompleted, statements } = await prepareCalculateReplayAttribute(db, scope, attributeId);
      await commitAttributeReplay(db, lock, statements, revision);
      if (attributeCompleted) completed.add(attributeId);
      continue;
    }

    const [head, metadata] = await Promise.all([queryReplayHistoryHead(db), queryFullReplayMetadata(db)]);
    const currentScope = replayScope(metadata);
    if (work.scope_json !== JSON.stringify(currentScope) || !await queryReplayAnchorMatches(db, work)) {
      work = await startReplayWork(db, lock, revision, historyRevision, head, currentScope);
      scope = currentScope;
      completed.clear();
      continue;
    }
    if (head.rowid > (work.online_rowid ?? work.target_rowid)) {
      if (work.online_rowid == null) {
        await extendReplayWork(db, lock, work, head, revision);
      } else {
        const { cursor, statements } = await prepareCatchUpOnlineReplay(db, scope, work.online_rowid, head.rowid, pageSize);
        await commitAttributeReplay(db, lock, statements, revision);
        work.online_rowid = cursor.rowid;
        work.online_response_id = cursor.response_id;
      }
      continue;
    }

    if (await queryReplayCatalogPending(db)) return 'pending';
    const calculated = await queryCalculatedReplayWork(db, metadata.subjectIds, metadata.attributes.keys());
    const replay = await prepareCalculatedAttributeReplay(db, timestamp, metadata, calculated, { compareLiveStates: true });
    await publishPreparedAttributeReplay(db, lock, timestamp, revision, replay, {}, {
      verify: [assertReplayHistoryHead(db, head), assertReplayCatalogVersion(db, metadata.throughVersion)],
      clear: prepareClearReplayWork(db),
      replayedRevision: work.online_rowid == null ? revision : work.input_revision ?? undefined,
    });
    return 'replay';
  }
  return 'pending';
};

/** Outside the weekly window only resume previously scheduled work. */
export const resumePendingAttributeReplay = async (
  db: Database, timestamp: number, budget: ReplayWorkBudget = {},
): Promise<ResumableReplayOutcome | null> => {
  if (!await queryAttributeReplayWork(db)) return null;
  const lock = await acquireAttributeReplayLock(db, timestamp);
  try {
    const work = await queryAttributeReplayWork(db);
    if (!work) return null;
    const status = await queryAttributeReplayStatus(db);
    return await runAttributeReplayWorkLocked(db, lock, timestamp, status, work, budget);
  } finally {
    await releaseAttributeReplayLock(db, lock);
  }
};
