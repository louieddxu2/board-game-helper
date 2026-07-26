ALTER TABLE rules ADD COLUMN tag_ids_json TEXT NOT NULL DEFAULT '[]';

UPDATE rules
SET tag_ids_json = COALESCE(
  (
    SELECT json_group_array(rt.tag_id)
    FROM rule_tags rt
    WHERE rt.rule_id = rules.id
  ),
  '[]'
);
