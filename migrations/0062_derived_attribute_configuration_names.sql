-- Configuration subjects keep the base game and expansion as components.
-- Their public name is derived from those components so a game rename or
-- merge cannot leave a stale copy of the base-game name behind.
CREATE VIEW attribute_subject_display_names AS
SELECT
  s.id,
  CASE WHEN s.kind = 'configuration' THEN
    COALESCE(base_component.game_name, base_component.label, s.display_name)
      || CASE WHEN expansion_components.expansion_name IS NOT NULL
        THEN '＋' || expansion_components.expansion_name ELSE '' END
  ELSE s.display_name END AS display_name
FROM attribute_subjects s
LEFT JOIN (
  SELECT c.subject_id, c.label, g.display_name AS game_name
  FROM attribute_subject_components c
  LEFT JOIN games g ON g.id = c.game_id
  WHERE c.component_type = 'base'
) base_component ON base_component.subject_id = s.id
LEFT JOIN (
  SELECT subject_id, group_concat(label, '＋') AS expansion_name
  FROM (
    SELECT subject_id, label
    FROM attribute_subject_components
    WHERE component_type = 'expansion'
    ORDER BY subject_id, component_order
  ) ordered_expansions
  GROUP BY subject_id
) expansion_components ON expansion_components.subject_id = s.id;

-- Keep the concise, user-facing expansion names in the component row. The
-- BGG title remains available through bgg_id and is not repeated in the UI.
UPDATE attribute_subject_components
SET label = CASE subject_id
  WHEN 'attribute_config_7th_continent_what_goes_up' THEN '有起必有落擴'
  WHEN 'attribute_config_barenpark_bad_news_bears' THEN '灰熊大進擊擴'
  WHEN 'attribute_config_barrage_leeghwater' THEN '利格沃特計畫擴'
  WHEN 'attribute_config_feast_for_odin_norwegians' THEN '挪威人擴'
  WHEN 'attribute_config_food_chain_magnate_ketchup' THEN '番茄醬擴'
  WHEN 'attribute_config_great_western_trail_rails_north' THEN '一路向北擴'
  WHEN 'attribute_config_marco_polo_agents_venice' THEN '威尼斯代理人擴'
  WHEN 'attribute_config_santa_maria_american_kingdoms' THEN '美洲大陸擴'
  WHEN 'attribute_config_trickerion_dahlgaards_academy' THEN '達爾加德學院擴'
  WHEN 'attribute_config_tzolkin_tribes_prophecies' THEN '部落與預言擴'
  ELSE label
END
WHERE component_type = 'expansion'
  AND subject_id IN (
    'attribute_config_7th_continent_what_goes_up',
    'attribute_config_barenpark_bad_news_bears',
    'attribute_config_barrage_leeghwater',
    'attribute_config_feast_for_odin_norwegians',
    'attribute_config_food_chain_magnate_ketchup',
    'attribute_config_great_western_trail_rails_north',
    'attribute_config_marco_polo_agents_venice',
    'attribute_config_santa_maria_american_kingdoms',
    'attribute_config_trickerion_dahlgaards_academy',
    'attribute_config_tzolkin_tribes_prophecies'
  );

-- Refresh the denormalized compatibility field and emit catalog deltas. The
-- view remains the source of truth for all future reads.
UPDATE attribute_subjects
SET display_name = (
      SELECT display_name
      FROM attribute_subject_display_names
      WHERE id = attribute_subjects.id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE kind = 'configuration'
  AND display_name <> (
    SELECT display_name
    FROM attribute_subject_display_names
    WHERE id = attribute_subjects.id
  );

-- A base-game rename or merge updates its base component. Keep the stored
-- compatibility name synchronized so incremental catalog updates are also
-- correct between weekly snapshots.
DROP TRIGGER attribute_subject_components_catalog_after_insert;
CREATE TRIGGER attribute_subject_components_catalog_after_insert
AFTER INSERT ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;

DROP TRIGGER attribute_subject_components_catalog_after_update;
CREATE TRIGGER attribute_subject_components_catalog_after_update
AFTER UPDATE OF component_order, game_id, component_type, label, bgg_id ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;

DROP TRIGGER attribute_subject_components_catalog_after_delete;
CREATE TRIGGER attribute_subject_components_catalog_after_delete
AFTER DELETE ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = OLD.subject_id;
END;

PRAGMA optimize;
