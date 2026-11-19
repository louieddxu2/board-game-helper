import { ATTRIBUTE_QUESTION_SLOT_COUNT, D1_SAFE_BOUND_PARAMETER_COUNT, chunk } from './attributeQueryShared';
import type { Database } from './database';

/** Bind rows directly: JSON virtual-table scans add avoidable reads on each upsert. */
export const attributeScoreWrites = (db: Database, rows: unknown[][]) =>
  chunk(rows, Math.floor(D1_SAFE_BOUND_PARAMETER_COUNT / 11)).map((page) => db.statement(`
    INSERT INTO attribute_score_states
      (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count, comparison_count,
       decisive_comparison_count, evidence_count, model_version, updated_at, random_key, question_slot)
    VALUES ${page.map(() => `(${Array.from({ length: 11 }, () => '?').join(', ')},
      lower(hex(randomblob(16))), ((random() & 2147483647) % ${ATTRIBUTE_QUESTION_SLOT_COUNT}) + 1)`).join(', ')}
    ON CONFLICT(subject_id, attribute_id) DO UPDATE SET
      score = excluded.score, rating_deviation = excluded.rating_deviation, direct_sum = excluded.direct_sum,
      direct_count = excluded.direct_count, comparison_count = excluded.comparison_count,
      decisive_comparison_count = excluded.decisive_comparison_count, evidence_count = excluded.evidence_count,
      model_version = excluded.model_version, updated_at = excluded.updated_at
  `).bind(...page.flat()));
