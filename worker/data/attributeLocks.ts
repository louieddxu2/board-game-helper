import { createId } from '../utils';
import type { AttributeMergeLock, AttributeResponseInput } from './attributeQueryShared';
import { ATTRIBUTE_MERGE_OPERATION_LOCK_NAME, ATTRIBUTE_REPLAY_LOCK_NAME, ATTRIBUTE_REPLAY_LOCK_TTL_MS, ATTRIBUTE_RESPONSE_LOCK_PREFIX, ATTRIBUTE_RESPONSE_LOCK_TTL_MS } from './attributeQueryShared';
import type { Database, DatabaseStatement } from './database';

export interface AttributeWriteLock {
  token: string;
  names: string[];
}

interface AttributeReplayLock {
  token: string;
}

export const acquireAttributeReplayLock = async (db: Database, timestamp: number): Promise<AttributeReplayLock> => {
  const token = createId('attribute-replay-lock');
  const now = Date.now();
  const expiresAt = Math.max(now, timestamp) + ATTRIBUTE_REPLAY_LOCK_TTL_MS;
  await db.statement(`
    DELETE FROM attribute_vote_lock
    WHERE lock_name = ? AND expires_at < ?
  `).bind(ATTRIBUTE_REPLAY_LOCK_NAME, now).run();
  const acquired = await db.statement(`
    INSERT OR IGNORE INTO attribute_vote_lock (lock_name, token, expires_at)
    SELECT ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1
      FROM attribute_vote_lock
      WHERE lock_name GLOB ? AND expires_at >= ?
    )
    RETURNING token
  `).bind(ATTRIBUTE_REPLAY_LOCK_NAME, token, expiresAt, `${ATTRIBUTE_RESPONSE_LOCK_PREFIX}:*`, now).first<{ token: string }>();
  if (acquired?.token !== token) throw new Error('attribute_replay_busy');
  return { token };
};

export const releaseAttributeReplayLock = (db: Database, lock: AttributeReplayLock) => db.statement(`
  DELETE FROM attribute_vote_lock
  WHERE lock_name = ? AND token = ?
`).bind(ATTRIBUTE_REPLAY_LOCK_NAME, lock.token).run();

export const attributeWriteLockNames = (input: AttributeResponseInput): string[] => {
  const subjectIds = new Set<string>();
  if (input.comparison != null || input.ratingA != null) subjectIds.add(input.subjectAId);
  if (input.comparison != null || input.ratingB != null) subjectIds.add(input.subjectBId);
  return [...subjectIds]
    .map((subjectId) => `${ATTRIBUTE_RESPONSE_LOCK_PREFIX}:${input.attributeId}:${subjectId}`)
    .sort();
};

export const batchChangeCount = (result: { meta?: { changes?: number } } | undefined) => result?.meta?.changes ?? 1;

const attributeMergeSubjectIds = async (db: Database, sourceGameId: string, targetGameId: string) => {
  const result = await db.statement(`
    SELECT subject.game_id, subject.id
    FROM attribute_subjects subject
    WHERE subject.kind = 'game'
      AND subject.game_id IN (?, ?)
  `).bind(sourceGameId, targetGameId).all<{ game_id: string; id: string }>();
  const byGameId = new Map((result.results ?? []).map((row) => [row.game_id, row.id]));
  return { sourceSubjectId: byGameId.get(sourceGameId) ?? null, targetSubjectId: byGameId.get(targetGameId) ?? null };
};

export const acquireAttributeMergeLock = async (
  db: Database,
  sourceGameId: string,
  targetGameId: string,
  timestamp: number,
): Promise<AttributeMergeLock> => {
  const [{ sourceSubjectId, targetSubjectId }, attributes] = await Promise.all([
    attributeMergeSubjectIds(db, sourceGameId, targetGameId),
    db.statement('SELECT id FROM attributes WHERE is_active = 1 ORDER BY id').all<{ id: string }>(),
  ]);
  const subjectIds = [sourceSubjectId, targetSubjectId].filter((id): id is string => Boolean(id));
  const names = [...new Set([
    ATTRIBUTE_MERGE_OPERATION_LOCK_NAME,
    ...(attributes.results ?? []).flatMap((attribute) => subjectIds.map((subjectId) => `${ATTRIBUTE_RESPONSE_LOCK_PREFIX}:${attribute.id}:${subjectId}`)),
  ])].sort();
  const token = createId('attribute-merge-lock');
  const now = Date.now();
  const expiresAt = Math.max(now, timestamp) + ATTRIBUTE_RESPONSE_LOCK_TTL_MS;
  const results = await db.batch([
    db.statement(`
      DELETE FROM attribute_vote_lock
      WHERE lock_name IN (${[...names, ATTRIBUTE_REPLAY_LOCK_NAME].map(() => '?').join(',')})
        AND expires_at < ?
    `).bind(...names, ATTRIBUTE_REPLAY_LOCK_NAME, now),
    ...names.map((name) => db.statement(`
      INSERT OR IGNORE INTO attribute_vote_lock (lock_name, token, expires_at)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM attribute_vote_lock
        WHERE lock_name = ? AND expires_at >= ?
      )
    `).bind(name, token, expiresAt, ATTRIBUTE_REPLAY_LOCK_NAME, now)),
  ]);
  const acquired = names.filter((_, index) => batchChangeCount(results[index + 1]) === 1);
  if (acquired.length !== names.length) {
    await releaseAttributeMergeLock(db, { token, names: acquired });
    throw new Error('attribute_response_busy');
  }
  return { token, names, sourceSubjectId, targetSubjectId };
};

export const releaseAttributeMergeLock = async (db: Database, lock: Pick<AttributeMergeLock, 'token' | 'names'>): Promise<void> => {
  if (!lock.names.length) return;
  await db.statement(`
    DELETE FROM attribute_vote_lock
    WHERE lock_name IN (${lock.names.map(() => '?').join(',')}) AND token = ?
  `).bind(...lock.names, lock.token).run();
};

export const canonicalizeAttributeMergeVoteSubjects = (
  db: Database,
  sourceSubjectId: string | null,
  targetSubjectId: string | null,
): DatabaseStatement | null => {
  if (!sourceSubjectId || !targetSubjectId || sourceSubjectId === targetSubjectId) return null;
  return db.statement(`
    UPDATE attribute_vote_responses
    SET subject_a_id = CASE WHEN subject_a_id = ? THEN ? ELSE subject_a_id END,
        subject_b_id = CASE WHEN subject_b_id = ? THEN ? ELSE subject_b_id END
    WHERE subject_a_id = ? OR subject_b_id = ?
  `).bind(sourceSubjectId, targetSubjectId, sourceSubjectId, targetSubjectId, sourceSubjectId, sourceSubjectId);
};
