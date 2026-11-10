import { encodeAttributeReplayChunks } from './attributeReplayChunks';
import {
  calculateAttributeReplay, mergeStateKey, pairStatKey,
  type CalculatedAttributeReplay, type FullReplayResponseRow, type ReplayPair,
} from './attributeReplayCalculation';
import type { OnlineAttributeState } from './attributeScoring';
import { attributeVoteWeight, queryAuthorizedAttributeVoters } from './attributeVoteWeights';
import type { Database } from './database';

export const ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE = 4_000;

export interface ReplayHistoryHead {
  rowid: number;
  response_id: string | null;
}

export interface ReplayWork {
  history_revision: number;
  model_version: string;
  scope_json: string;
  target_rowid: number;
  target_response_id: string | null;
  scanned_rowid: number;
}

export type ReplayScope = [subjectIds: string[], attributeIds: string[]];
type WorkKind = 'history' | 'states' | 'pairs';
type VoteRow = Omit<FullReplayResponseRow, 'weight'> & { actor_id: string | null; replay_rowid: number };
type VoteEntry = [
  responseId: string, subjectAId: string, subjectBId: string | null,
  ratingA: number | null, ratingB: number | null, comparison: FullReplayResponseRow['comparison'],
  createdAt: number, weight: number,
];

export const queryAttributeReplayWork = (db: Database) => db.statement(`
  SELECT history_revision, model_version, scope_json, target_rowid, target_response_id, scanned_rowid
  FROM attribute_replay_work WHERE id = 1
`).first<ReplayWork>();

export const queryReplayHistoryRevision = async (db: Database) => {
  const status = await db.statement('SELECT history_revision FROM attribute_replay_status WHERE id = 1')
    .first<{ history_revision: number }>();
  return status?.history_revision ?? 0;
};

export const queryReplayHistoryHead = async (db: Database): Promise<ReplayHistoryHead> => {
  return await db.statement(`
    SELECT rowid, response_id FROM attribute_vote_responses ORDER BY rowid DESC LIMIT 1
  `).first<ReplayHistoryHead>() ?? { rowid: 0, response_id: null };
};

// SQLite can renumber implicit rowids during a database rebuild. A changed
// anchor invalidates the staged input instead of letting a cursor skip votes.
export const queryReplayAnchorMatches = async (db: Database, work: ReplayWork): Promise<boolean> => {
  if (!work.target_rowid) return true;
  const row = await db.statement('SELECT response_id FROM attribute_vote_responses WHERE rowid = ?')
    .bind(work.target_rowid).first<{ response_id: string }>();
  return row?.response_id === work.target_response_id;
};

export const assertReplayHistoryHead = (db: Database, head: ReplayHistoryHead) => db.statement(`
  SELECT json_extract('{}', CASE WHEN COALESCE((
    SELECT rowid FROM attribute_vote_responses ORDER BY rowid DESC LIMIT 1
  ), 0) = ? AND (
    SELECT response_id FROM attribute_vote_responses ORDER BY rowid DESC LIMIT 1
  ) IS ? THEN '$' ELSE 'attribute_replay_history_head_changed' END)
`).bind(head.rowid, head.response_id);

const replayCatalogOutbox = `
  SELECT 1 FROM catalog_change_outbox
  WHERE catalog IN ('attribute-subject', 'attribute-definition', 'attribute-candidate')
`;

export const queryReplayCatalogPending = async (db: Database) =>
  Boolean(await db.statement(`${replayCatalogOutbox} LIMIT 1`).first());

export const assertReplayCatalogVersion = (db: Database, version: number) => db.statement(`
  SELECT json_extract('{}', CASE WHEN (
    SELECT current_version FROM attribute_catalog_clock WHERE id = 1
  ) = ? AND NOT EXISTS (${replayCatalogOutbox}) THEN '$' ELSE 'attribute_replay_catalog_changed' END)
`).bind(version);

export const prepareClearReplayWork = (db: Database) => [
  db.statement('DELETE FROM attribute_replay_work_chunks'),
  db.statement('DELETE FROM attribute_replay_work WHERE id = 1'),
];

export const prepareStartReplayWork = (db: Database, work: ReplayWork) => [
  ...prepareClearReplayWork(db),
  db.statement(`
    INSERT INTO attribute_replay_work
      (id, history_revision, model_version, scope_json, target_rowid, target_response_id, scanned_rowid)
    VALUES (1, ?, ?, ?, ?, ?, 0)
  `).bind(work.history_revision, work.model_version, work.scope_json, work.target_rowid, work.target_response_id),
];

export const prepareExtendReplayWork = (db: Database, head: ReplayHistoryHead) => db.statement(`
  UPDATE attribute_replay_work SET target_rowid = ?, target_response_id = ? WHERE id = 1
`).bind(head.rowid, head.response_id);

const prepareChunks = (db: Database, kind: WorkKind, attributeId: string, page: number, rows: unknown[][]) =>
  encodeAttributeReplayChunks(rows).map((payload, number) => db.statement(`
    INSERT INTO attribute_replay_work_chunks (kind, attribute_id, page, chunk_number, payload)
    VALUES (?, ?, ?, ?, ?)
  `).bind(kind, attributeId, page, number, payload));

export const prepareCaptureReplayHistory = async (
  db: Database, work: ReplayWork, scope: ReplayScope, completed: ReadonlySet<string>, pageSize: number,
) => {
  const [result, authorized] = await Promise.all([
    db.statement(`
      SELECT rowid AS replay_rowid, response_id, attribute_id, subject_a_id, subject_b_id,
        rating_a, rating_b, comparison, created_at, actor_id
      FROM attribute_vote_responses WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?
    `).bind(work.scanned_rowid, work.target_rowid, pageSize).all<VoteRow>(),
    queryAuthorizedAttributeVoters(db),
  ]);
  const rows = result.results ?? [];
  if (!rows.length) throw new Error('attribute_replay_history_anchor_missing');
  const attributeIds = new Set(scope[1]);
  const pages = new Map<string, VoteEntry[]>();
  for (const row of rows) {
    if (!attributeIds.has(row.attribute_id)) continue;
    const entries = pages.get(row.attribute_id) ?? [];
    entries.push([
      row.response_id, row.subject_a_id, row.subject_b_id, row.rating_a, row.rating_b,
      row.comparison, row.created_at, attributeVoteWeight(row.actor_id, authorized.has(row.actor_id ?? '')),
    ]);
    pages.set(row.attribute_id, entries);
  }
  const cursor = rows.at(-1)!.replay_rowid;
  const statements = [...pages].flatMap(([attributeId, entries]) => prepareChunks(db, 'history', attributeId, cursor, entries));
  const invalidated = [...pages.keys()].filter((attributeId) => completed.has(attributeId));
  if (invalidated.length) {
    // A comparison can arrive behind the chronological cursor. Recalculate
    // only the attributes touched by the newly captured input.
    statements.push(db.statement(`
      DELETE FROM attribute_replay_work_chunks
      WHERE kind IN ('states', 'pairs') AND attribute_id IN (SELECT value FROM json_each(?))
    `).bind(JSON.stringify(invalidated)));
  }
  statements.push(db.statement('UPDATE attribute_replay_work SET scanned_rowid = ? WHERE id = 1').bind(cursor));
  return { cursor, statements, invalidated };
};

export const queryCompletedReplayAttributes = async (db: Database) => {
  const result = await db.statement(`
    SELECT attribute_id FROM attribute_replay_work_chunks
    WHERE kind = 'states' AND page = 0 AND chunk_number = 0
  `).all<{ attribute_id: string }>();
  return new Set((result.results ?? []).map(({ attribute_id }) => attribute_id));
};

export const prepareCalculateReplayAttribute = async (db: Database, scope: ReplayScope, attributeId: string) => {
  const result = await db.statement(`
    SELECT payload FROM attribute_replay_work_chunks
    WHERE kind = 'history' AND attribute_id = ? ORDER BY page, chunk_number
  `).bind(attributeId).all<{ payload: string }>();
  const votes = (result.results ?? []).flatMap(({ payload }) => JSON.parse(payload) as VoteEntry[]).map(
    ([response_id, subject_a_id, subject_b_id, rating_a, rating_b, comparison, created_at, weight]): FullReplayResponseRow =>
      ({ response_id, attribute_id: attributeId, subject_a_id, subject_b_id, rating_a, rating_b, comparison, created_at, weight }),
  );
  const { states, pairCounts } = calculateAttributeReplay(new Set(scope[0]), new Set([attributeId]), votes);
  return [
    ...prepareChunks(db, 'states', attributeId, 0, [...states]),
    ...prepareChunks(db, 'pairs', attributeId, 0, [...pairCounts.values()].map(
      ({ subjectAId, subjectBId, count }) => [subjectAId, subjectBId, count],
    )),
  ];
};

export const queryCalculatedReplayWork = async (db: Database, subjectIds: Iterable<string>, attributeIds: Iterable<string>): Promise<CalculatedAttributeReplay> => {
  const result = await db.statement(`
    SELECT kind, attribute_id, payload FROM attribute_replay_work_chunks
    WHERE kind IN ('states', 'pairs') ORDER BY kind, attribute_id, page, chunk_number
  `).all<{ kind: 'states' | 'pairs'; attribute_id: string; payload: string }>();
  const capturedStates = new Map<string, OnlineAttributeState>();
  const pairCounts = new Map<string, ReplayPair>();
  for (const row of result.results ?? []) {
    if (row.kind === 'states') {
      for (const [key, state] of JSON.parse(row.payload) as Array<[string, OnlineAttributeState]>) capturedStates.set(key, state);
    } else {
      for (const [subjectAId, subjectBId, count] of JSON.parse(row.payload) as Array<[string, string, number]>) {
        const attributeId = row.attribute_id;
        pairCounts.set(pairStatKey(subjectAId, subjectBId, attributeId), { subjectAId, subjectBId, attributeId, count });
      }
    }
  }
  const states = new Map<string, OnlineAttributeState>();
  const attributes = [...attributeIds];
  for (const subjectId of subjectIds) for (const attributeId of attributes) {
    const key = mergeStateKey(subjectId, attributeId);
    const state = capturedStates.get(key);
    if (!state) throw new Error('incomplete_attribute_replay_work');
    states.set(key, state);
  }
  return { states, pairCounts };
};
