-- Use the short name consistently with the other expansion labels.
UPDATE attribute_subject_components
SET label = '威尼斯擴'
WHERE subject_id = 'attribute_config_marco_polo_agents_venice'
  AND component_type = 'expansion';

UPDATE attribute_subjects
SET display_name = (
      SELECT display_name
      FROM attribute_subject_display_names
      WHERE id = attribute_subjects.id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'attribute_config_marco_polo_agents_venice';

PRAGMA optimize;
