import { createId } from '../utils';
import { attributeWriteLockNames, batchChangeCount, type AttributeWriteLock } from './attributeLocks';
import { ATTRIBUTE_REPLAY_LOCK_NAME, ATTRIBUTE_RESPONSE_LOCK_TTL_MS, type AttributeResponseInput } from './attributeQueryShared';
import { ATTRIBUTE_SCORE_MODEL_VERSION, type OnlineAttributeState } from './attributeScoring';
import { randomQuestionSlot } from './attributeResponseContext';
import type { Database, DatabaseStatement } from './database';

export const releaseAttributeWriteLock = (db: Database, lock: AttributeWriteLock) => db.statement(`
  DELETE FROM attribute_vote_lock
  WHERE lock_name IN (SELECT value FROM json_each(?)) AND token = ?
`).bind(JSON.stringify(lock.names), lock.token);

export const acquireAttributeWriteLock = async (db: Database, input: AttributeResponseInput): Promise<AttributeWriteLock> => {
  const token = createId('attribute-lock');
  const names = attributeWriteLockNames(input);
  const now = Date.now();
  const expiresAt = Math.max(now, input.timestamp) + ATTRIBUTE_RESPONSE_LOCK_TTL_MS;
  const results = await db.batch([
    db.statement(`DELETE FROM attribute_vote_lock
      WHERE lock_name IN (SELECT value FROM json_each(?)) AND expires_at < ?`)
      .bind(JSON.stringify([...names, ATTRIBUTE_REPLAY_LOCK_NAME]), now),
    ...names.map((name) => db.statement(`
      INSERT OR IGNORE INTO attribute_vote_lock (lock_name, token, expires_at)
      SELECT ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM attribute_vote_lock WHERE lock_name = ? AND expires_at >= ?
      )
    `).bind(name, token, expiresAt, ATTRIBUTE_REPLAY_LOCK_NAME, now)),
  ]);
  const acquired = names.filter((_, index) => batchChangeCount(results[index + 1]) === 1);
  if (acquired.length !== names.length) {
    if (acquired.length) await releaseAttributeWriteLock(db, { token, names: acquired }).run();
    throw new Error('attribute_response_busy');
  }
  return { token, names };
};

/** Check the lease inside the write transaction, after any Worker-side calculation. */
export const commitAttributeResponse = async (db: Database, lock: AttributeWriteLock, statements: DatabaseStatement[]) => {
  try {
    await db.batch([
      db.statement(`SELECT json_extract('{}', CASE WHEN (
        SELECT COUNT(*) FROM attribute_vote_lock
        WHERE lock_name IN (SELECT value FROM json_each(?))
          AND token = ? AND expires_at > unixepoch('subsec') * 1000
      ) = ? THEN '$' ELSE 'attribute_response_busy' END)`)
        .bind(JSON.stringify(lock.names), lock.token, lock.names.length),
      ...statements,
      releaseAttributeWriteLock(db, lock),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('attribute_response_busy')) throw new Error('attribute_response_busy');
    throw error;
  }
};

export const attributeScoreUpsert = (db: Database, subjectId: string, attributeId: string, state: OnlineAttributeState, timestamp: number) => db.statement(`
  INSERT INTO attribute_score_states
    (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
     comparison_count, decisive_comparison_count, evidence_count, model_version, updated_at, random_key, question_slot)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, lower(hex(randomblob(16))), ?)
  ON CONFLICT(subject_id, attribute_id) DO UPDATE SET
    score = excluded.score, rating_deviation = excluded.rating_deviation,
    direct_sum = excluded.direct_sum, direct_count = excluded.direct_count,
    comparison_count = excluded.comparison_count, decisive_comparison_count = excluded.decisive_comparison_count,
    evidence_count = excluded.evidence_count, model_version = excluded.model_version, updated_at = excluded.updated_at
`).bind(subjectId, attributeId, state.score, state.ratingDeviation, state.directSum, state.directCount,
  state.comparisonCount, state.decisiveComparisonCount, state.evidenceCount, ATTRIBUTE_SCORE_MODEL_VERSION, timestamp, randomQuestionSlot());
