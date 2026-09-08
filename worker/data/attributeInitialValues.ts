import type { Database } from './database';
import { initialAttributeState, type AttributeInitialValue } from './attributeScoring';

/** Read durable baselines separately from the disposable score-state cache. */
export const queryAttributeInitialValues = async (db: Database, attributeId: string): Promise<AttributeInitialValue[]> => {
  const result = await db.statement(`
    SELECT v.subject_id, v.attribute_id, v.score, b.cutoff_created_at
    FROM attribute_initial_values v
    JOIN attribute_initial_value_batches b ON b.id = v.batch_id AND b.target_attribute_id = v.attribute_id
    WHERE v.attribute_id = ?
    ORDER BY v.subject_id
  `).bind(attributeId).all<{ subject_id: string; attribute_id: string; score: number; cutoff_created_at: number }>();
  return (result.results ?? []).map((row) => {
    const score = Number(row.score);
    initialAttributeState(score); // Same range validation as replay/online initialization.
    const cutoffCreatedAt = Number(row.cutoff_created_at);
    if (!Number.isSafeInteger(cutoffCreatedAt) || cutoffCreatedAt < 0) throw new Error('invalid_attribute_initial_cutoff');
    return { subjectId: row.subject_id, attributeId: row.attribute_id, score, cutoffCreatedAt };
  });
};
