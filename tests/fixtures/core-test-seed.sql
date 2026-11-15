-- Schema exports intentionally omit data. These singleton rows are required by
-- catalog triggers when the core flow creates its first game and rule.
INSERT OR IGNORE INTO game_catalog_clock (id, current_version) VALUES (1, 0);
INSERT OR IGNORE INTO public_tag_catalog_clock (id, current_version) VALUES (1, 0);
INSERT OR IGNORE INTO attribute_catalog_clock (id, current_version) VALUES (1, 0);

-- A schema-only export has no active game snapshot. Start from an empty real
-- snapshot; submissions then publish their normal versioned catalog deltas.
INSERT OR IGNORE INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
VALUES (1, 0, '[]');
INSERT OR IGNORE INTO game_catalog_snapshot_state (id, active_generation, through_version, chunk_count, generated_at)
VALUES (1, 1, 0, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

-- Isolated voting configurations exercise the real response and snapshot APIs
-- without adding games to the rule catalog used by the other core scenarios.
INSERT INTO attributes (id, key, sort_order) VALUES ('core-ranking', 'core_ranking_luck', 0);
INSERT INTO attribute_translations (attribute_id, locale, name, full_description)
VALUES ('core-ranking', 'zh-TW', '運氣成分', '玩家有多容易靠運氣取得勝利。');

WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM sequence WHERE n < 22)
INSERT INTO attribute_subjects (id, slug, kind, display_name, created_at, updated_at)
SELECT 'core-rank-' || n, 'core-rank-' || n, 'configuration', '排序遊戲 ' || n, 1, 1 FROM sequence;

WITH RECURSIVE components(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM components WHERE n < 2)
INSERT INTO attribute_subject_components (subject_id, component_order, component_type, label, bgg_id)
SELECT subject.id, n, CASE n WHEN 1 THEN 'base' ELSE 'expansion' END,
  CASE n WHEN 1 THEN subject.display_name ELSE '擴充' END, 9990000 + 10 * CAST(substr(subject.id, 11) AS INTEGER) + n
FROM attribute_subjects subject CROSS JOIN components WHERE subject.id GLOB 'core-rank-*';

INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 1, 0, json_group_array(json_object('kind', 'subject', 'values', json('[]'),
  'subject', json_object('id', id, 'slug', slug, 'kind', kind, 'displayName', display_name)))
FROM attribute_subjects WHERE id GLOB 'core-rank-*';

INSERT INTO attribute_catalog_snapshot_state
  (id, active_generation, through_version, chunk_count, attributes_json, score_model_version, generated_at)
SELECT 1, 1, current_version, 1,
  json_array(json_object('id', a.id, 'key', a.key, 'name', t.name, 'fullDescription', t.full_description,
    'minValue', a.min_value, 'maxValue', a.max_value, 'sortOrder', a.sort_order)),
  'glicko-rd-v2', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM attribute_catalog_clock CROSS JOIN attributes a JOIN attribute_translations t ON t.attribute_id = a.id
WHERE a.id = 'core-ranking' AND t.locale = 'zh-TW';
