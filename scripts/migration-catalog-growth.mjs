// Synthetic, unrelated catalog entries for the local migration cost gate. Keep the
// real constraints, indexes and triggers: only fixture setup is outside measurement.
export const MIGRATION_CATALOG_GROWTH_SUBJECTS = 2_000;

export const seedMigrationCatalogGrowth = (db) => {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(({ name }) => name));
  if (!['attribute_subjects', 'attributes', 'attribute_score_states'].every((name) => tables.has(name))) return undefined;
  const prefix = 'migration-row-budget-growth:';
  db.exec('BEGIN');
  try {
    db.prepare(`
      WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
      INSERT INTO attribute_subjects (id, slug, kind, display_name, created_at, updated_at)
      SELECT ? || n, ? || n, 'configuration', 'Cost fixture ' || n, 0, 0 FROM numbers
    `).run(MIGRATION_CATALOG_GROWTH_SUBJECTS, prefix, prefix);
    const { changes } = db.prepare(`
      INSERT INTO attribute_score_states
        (subject_id, attribute_id, score, direct_sum, direct_count, evidence_count, updated_at)
      SELECT subject.id, attribute.id, 5, 5, 1, 1, 0
      FROM attribute_subjects subject CROSS JOIN attributes attribute
      WHERE subject.id >= ? AND subject.id < ?
    `).run(prefix, `${prefix}\uffff`);
    db.exec('COMMIT');
    return { subjects: MIGRATION_CATALOG_GROWTH_SUBJECTS, scores: Number(changes) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
