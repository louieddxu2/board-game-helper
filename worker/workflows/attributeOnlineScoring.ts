import { expandStoredRankingResponse } from '../../src/shared/attributeRankingBallot';
import type { AttributeComparisonResult, AttributeMatrixValue } from '../../src/shared/types';
import { acquireAttributeReplayLock, commitAttributeReplay, releaseAttributeReplayLock } from '../data/attributeLocks';
import { ATTRIBUTE_REPLAY_LOCK_NAME } from '../data/attributeQueryShared';
import { attributeScoreWrites } from '../data/attributeScoreWrites';
import { prepareAttributeScorePublication } from '../data/attributeCatalogPublication';
import { stateToMatrixValue } from '../data/attributeResponseContext';
import { applyComparison, applyDirectRating, emptyAttributeState, ATTRIBUTE_SCORE_MODEL_VERSION, type OnlineAttributeState } from '../data/attributeScoring';
import type { Database } from '../data/database';

interface Progress { through_rowid: number; through_response_id: string | null; anchor_id: string | null; model_version: string; history_revision: number; }
interface PendingResponse {
  receipt_rowid: number; response_id: string; attribute_id: string | null;
  subject_a_id: string | null; subject_b_id: string | null; rating_a: number | null; rating_b: number | null;
  comparison: AttributeComparisonResult | null; ranking_json: string | null;
  recorded_online: number; online_weight: number | null; created_at: number;
}
interface StateRow {
  subject_id: string; attribute_id: string; score: number | null; rating_deviation: number;
  direct_sum: number; direct_count: number; comparison_count: number; decisive_comparison_count: number;
  evidence_count: number; updated_at: number;
}
export interface OnlineScoringResult {
  status: 'idle' | 'processed' | 'pending' | 'busy';
  throughRowid: number;
  updatedValues: AttributeMatrixValue[];
  batches: number;
}
const stateKey = (subject: string, attribute: string) => `${subject}\0${attribute}`;

export const acknowledgeOnlineResponses = (db: Database, through: number, responseId: string | null) => db.statement(`
  UPDATE attribute_online_progress SET through_rowid = ?,
    through_response_id = ?, model_version = ? WHERE id = 1
`).bind(through, responseId, ATTRIBUTE_SCORE_MODEL_VERSION);

const queryProgress = (db: Database) => db.statement(`
  SELECT progress.through_rowid, progress.through_response_id, progress.model_version, replay.history_revision,
    (SELECT response_id FROM attribute_vote_responses WHERE rowid = progress.through_rowid) AS anchor_id
  FROM attribute_online_progress progress JOIN attribute_replay_status replay ON replay.id = progress.id
  WHERE progress.id = 1
`).first<Progress>();

/** Idle daily recovery reads a bounded cursor/head lookup and performs no writes. */
export const hasPendingAttributeResponses = async (db: Database) => Boolean(await db.statement(`
  SELECT 1 FROM attribute_online_progress WHERE id = 1 AND EXISTS (
    SELECT 1 FROM attribute_vote_responses WHERE rowid > through_rowid LIMIT 1
  )
`).first());

const prepareScores = async (db: Database, receipts: PendingResponse[]) => {
  const rows = receipts.filter((row) => row.recorded_online === 1 && row.online_weight != null).flatMap(expandStoredRankingResponse);
  const targets = new Map<string, [string, string]>();
  for (const row of rows) {
    if (!row.attribute_id) continue;
    for (const id of [row.subject_a_id, row.subject_b_id]) if (id) targets.set(stateKey(id, row.attribute_id), [id, row.attribute_id]);
  }
  const result = targets.size ? await db.statement(`
    SELECT subject.id AS subject_id, attribute.id AS attribute_id, state.score, state.rating_deviation,
      state.direct_sum, state.direct_count, state.comparison_count, state.decisive_comparison_count,
      state.evidence_count, state.updated_at
    FROM json_each(?) target
    CROSS JOIN attribute_subjects subject ON subject.id = target.value ->> 0
    CROSS JOIN attributes attribute ON attribute.id = target.value ->> 1 AND attribute.is_active = 1
    LEFT JOIN attribute_score_states state ON state.subject_id = subject.id AND state.attribute_id = attribute.id
  `).bind(JSON.stringify([...targets.values()])).all<StateRow>() : { results: [] };
  const states = new Map<string, OnlineAttributeState>();
  const timestamps = new Map<string, number>();
  for (const row of result.results ?? []) {
    const key = stateKey(row.subject_id, row.attribute_id);
    states.set(key, row.score == null ? emptyAttributeState() : {
      score: row.score, ratingDeviation: row.rating_deviation, directSum: row.direct_sum, directCount: row.direct_count,
      comparisonCount: row.comparison_count, decisiveComparisonCount: row.decisive_comparison_count, evidenceCount: row.evidence_count,
    });
    timestamps.set(key, row.updated_at ?? 0);
  }
  const touched = new Set<string>();
  const lastReceipt = new Map<string, number>();
  let outOfOrder = false;
  for (const row of rows) {
    if (!row.attribute_id) continue;
    const a = row.subject_a_id ? stateKey(row.subject_a_id, row.attribute_id) : '';
    const b = row.subject_b_id ? stateKey(row.subject_b_id, row.attribute_id) : '';
    const update = (key: string, state: OnlineAttributeState) => {
      states.set(key, state); timestamps.set(key, row.created_at); touched.add(key); lastReceipt.set(key, row.receipt_rowid);
    };
    if (row.rating_a != null && states.has(a)) update(a, applyDirectRating(states.get(a)!, row.rating_a, row.online_weight!).next);
    if (row.rating_b != null && states.has(b)) update(b, applyDirectRating(states.get(b)!, row.rating_b, row.online_weight!).next);
    if (row.comparison && a !== b && states.has(a) && states.has(b)) {
      if (row.rating_a == null && row.rating_b == null && [a, b].some((key) =>
        lastReceipt.get(key) !== row.receipt_rowid && timestamps.get(key)! >= row.created_at)) outOfOrder = true;
      const next = applyComparison(states.get(a)!, states.get(b)!, row.comparison, row.online_weight!);
      update(a, next.a.next); update(b, next.b.next);
    }
  }
  const values = [...touched].map((key) => {
    const [subject, attribute] = targets.get(key)!;
    return stateToMatrixValue(subject, attribute, states.get(key)!);
  });
  const upserts = [...touched].map((key) => {
    const [subject, attribute] = targets.get(key)!;
    const s = states.get(key)!;
    return [subject, attribute, s.score, s.ratingDeviation, s.directSum, s.directCount,
      s.comparisonCount, s.decisiveComparisonCount, s.evidenceCount, ATTRIBUTE_SCORE_MODEL_VERSION, timestamps.get(key)];
  });
  return { values, outOfOrder, upserts };
};

/** One global scoring lease; losing upload requests never read history or score states. */
export const processAttributeResponses = async (
  db: Database, options: { pageSize?: number; maxBatches?: number; coalesceMs?: number } = {},
): Promise<OnlineScoringResult> => {
  const result: OnlineScoringResult = { status: 'idle', throughRowid: 0, updatedValues: [], batches: 0 };
  let lock;
  try { lock = await acquireAttributeReplayLock(db, Date.now()); }
  catch (error) {
    if (error instanceof Error && error.message === 'attribute_replay_busy') return { ...result, status: 'busy' };
    throw error;
  }
  let released = false;
  try {
    if (options.coalesceMs) await new Promise((resolve) => setTimeout(resolve, options.coalesceMs));
    for (let i = 0; i < (options.maxBatches ?? 2); i++) {
      const progress = await queryProgress(db);
      if (!progress || progress.model_version !== ATTRIBUTE_SCORE_MODEL_VERSION
        || (progress.through_rowid > 0 && progress.anchor_id !== progress.through_response_id)) return { ...result, status: 'pending' };
      const pending = await db.statement(`SELECT rowid AS receipt_rowid, response_id, attribute_id,
        subject_a_id, subject_b_id, rating_a, rating_b, comparison, ranking_json, recorded_online, online_weight, created_at
        FROM attribute_vote_responses WHERE rowid > ? ORDER BY rowid LIMIT ?`)
        .bind(progress.through_rowid, options.pageSize ?? 10).all<PendingResponse>();
      const receipts = pending.results ?? [];
      const through = receipts.at(-1)?.receipt_rowid ?? progress.through_rowid;
      const plan = await prepareScores(db, receipts);
      const statements = [db.statement(`SELECT json_extract('{}', CASE WHEN EXISTS (
        SELECT 1 FROM attribute_online_progress progress JOIN attribute_replay_status replay ON replay.id = progress.id
        WHERE progress.id = 1 AND progress.through_rowid = ? AND replay.history_revision = ?
      ) THEN '$' ELSE 'attribute_online_revision_changed' END)`).bind(progress.through_rowid, progress.history_revision)];
      if (plan.upserts.length) {
        // This transaction owns the score/replay lease. Suppress whole-subject
        // outbox triggers only while publishing these exact score deltas.
        statements.push(db.statement('INSERT INTO attribute_catalog_rebuild_mode (id) VALUES (1)'));
        statements.push(...attributeScoreWrites(db, plan.upserts));
        statements.push(...prepareAttributeScorePublication(db, plan.values));
        statements.push(db.statement('DELETE FROM attribute_catalog_rebuild_mode WHERE id = 1'));
      }
      if (receipts.length) statements.push(acknowledgeOnlineResponses(db, through, receipts.at(-1)!.response_id));
      if (plan.outOfOrder) statements.push(db.statement('UPDATE attribute_replay_status SET required_revision = required_revision + 1 WHERE id = 1'));
      // This indexed emptiness test and lease release share the score transaction.
      // A receipt arriving before it keeps the owner running; one arriving after it
      // can acquire the released lease itself. No lost wakeup between the two.
      statements.push(db.statement(`DELETE FROM attribute_vote_lock WHERE lock_name = ? AND token = ?
        AND NOT EXISTS (SELECT 1 FROM attribute_vote_responses WHERE rowid > ? LIMIT 1) RETURNING token`)
        .bind(ATTRIBUTE_REPLAY_LOCK_NAME, lock.token, through));
      const committed = await commitAttributeReplay(db, lock, statements);
      released = Boolean(committed.at(-1)?.results?.length);
      result.throughRowid = through;
      result.updatedValues.push(...plan.values);
      if (receipts.length) result.batches++;
      if (released) return { ...result, status: result.batches ? 'processed' : 'idle' };
    }
    return { ...result, status: 'pending' };
  } finally {
    if (!released) await releaseAttributeReplayLock(db, lock);
  }
};
