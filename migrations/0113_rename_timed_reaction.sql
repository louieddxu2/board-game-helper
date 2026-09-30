UPDATE attribute_translations
SET name = '限時反應',
    full_description = '遊戲有真實時間限制或競速，或社交互動上的即時反應。'
WHERE attribute_id = 'attribute_real_time_reaction' AND locale = 'zh-TW';

-- Patch existing definition deltas so they cannot restore the previous copy.
UPDATE attribute_catalog_entries
SET entry_json = json_set(entry_json,
      '$.attribute.name', '限時反應',
      '$.attribute.fullDescription', '遊戲有真實時間限制或競速，或社交互動上的即時反應。')
WHERE entry_key = 'attribute:attribute_real_time_reaction' AND deleted = 0;

-- Only edit the definition array in the single snapshot metadata row.
-- A newer timestamp tells browser caches to reload; score chunks stay intact.
UPDATE attribute_catalog_snapshot_state
SET attributes_json = (
      SELECT json_group_array(json(CASE
        WHEN json_extract(value, '$.id') = 'attribute_real_time_reaction'
        THEN json_set(value,
          '$.name', '限時反應',
          '$.fullDescription', '遊戲有真實時間限制或競速，或社交互動上的即時反應。')
        ELSE value
      END))
      FROM json_each(attributes_json)
    ),
    generated_at = MAX(generated_at + 1, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
WHERE id = 1 AND EXISTS (
  SELECT 1 FROM json_each(attributes_json)
  WHERE json_extract(value, '$.id') = 'attribute_real_time_reaction'
);
