-- English names belong to attribute expansion components only. They are kept
-- out of the shared games table so this does not change wrong-rule search.
UPDATE attribute_subject_components
SET english_name = CASE subject_id
  WHEN 'attribute_config_santa_maria_american_kingdoms' THEN 'Santa Maria: American Kingdoms'
  WHEN 'attribute_config_barenpark_bad_news_bears' THEN 'The Bad News Bears'
  WHEN 'attribute_config_feast_for_odin_norwegians' THEN 'The Norwegians'
  WHEN 'attribute_config_trickerion_dahlgaards_academy' THEN 'Dahlgaard''s Academy'
  WHEN 'attribute_config_tzolkin_tribes_prophecies' THEN 'Tribes & Prophecies'
  WHEN 'attribute_config_food_chain_magnate_ketchup' THEN 'The Ketchup Mechanism & Other Ideas'
  WHEN 'attribute_config_marco_polo_agents_venice' THEN 'Agents of Venice'
  WHEN 'attribute_config_great_western_trail_rails_north' THEN 'Rails to the North'
  WHEN 'attribute_config_7th_continent_what_goes_up' THEN 'What Goes Up, Must Come Down'
  WHEN 'attribute_config_barrage_leeghwater' THEN 'The Leeghwater Project'
  ELSE english_name
END
WHERE component_type = 'expansion'
  AND subject_id IN (
    'attribute_config_santa_maria_american_kingdoms',
    'attribute_config_barenpark_bad_news_bears',
    'attribute_config_feast_for_odin_norwegians',
    'attribute_config_trickerion_dahlgaards_academy',
    'attribute_config_tzolkin_tribes_prophecies',
    'attribute_config_food_chain_magnate_ketchup',
    'attribute_config_marco_polo_agents_venice',
    'attribute_config_great_western_trail_rails_north',
    'attribute_config_7th_continent_what_goes_up',
    'attribute_config_barrage_leeghwater'
  )
  AND NULLIF(TRIM(english_name), '') IS NULL;

-- Keep the weekly/incremental catalog focused on the requested component
-- English name. The earlier metadata migration created an unused alias table;
-- it remains inert for migration compatibility and is not exposed by the app.
DROP VIEW attribute_subject_component_catalog_json;
CREATE VIEW attribute_subject_component_catalog_json AS
SELECT c.subject_id, c.component_order,
  json_object(
    'order', c.component_order,
    'gameId', c.game_id,
    'type', c.component_type,
    'label', c.label,
    'englishName', c.english_name,
    'bggId', c.bgg_id
  ) AS component_json
FROM attribute_subject_components c;

PRAGMA optimize;
