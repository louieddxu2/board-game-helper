-- Fill the canonical Chinese display names for the votable BGG game entities
-- that have one unambiguous Chinese title in Final_BggCollection.csv.
-- Keep the previous display name as english_name so the existing English title
-- remains available to the catalog and attribute-voting clients.

CREATE TABLE migration_0078_final_bgg_names (
  game_id TEXT PRIMARY KEY,
  bgg_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL
);

INSERT INTO migration_0078_final_bgg_names (game_id, bgg_id, display_name, normalized_name)
VALUES
  ('game_bgg_445868', 445868, '蚊子逃逃', '蚊子逃逃'),
  ('game_bgg_184462', 184462, '腦力煉金術', '腦力煉金術'),
  ('game_bgg_360471', 360471, '紙筆潛水', '紙筆潛水'),
  ('game_bgg_418354', 418354, '巴比倫', '巴比倫'),
  ('game_bgg_413246', 413246, '炸彈剋星', '炸彈剋星'),
  ('game_04e027e4990a203f4899', 552, '公車', '公車'),
  ('game_bgg_214', 214, '國際咖啡館', '國際咖啡館'),
  ('game_bgg_310873', 310873, '卡內基', '卡內基'),
  ('game_bgg_300300', 300300, '推理事件簿千年系列：1400', '推理事件簿千年系列1400'),
  ('game_bgg_302098', 302098, '推理事件簿千年系列：1900', '推理事件簿千年系列1900'),
  ('game_bgg_302312', 302312, '推理事件簿千年系列：2400', '推理事件簿千年系列2400'),
  ('game_bgg_312251', 312251, '怪奇運輸站', '怪奇運輸站'),
  ('game_bgg_344554', 344554, '同房異夢', '同房異夢'),
  ('game_f1cfad0788a94bca858f49ff281e51dd', 426513, '餘燼葉', '餘燼葉'),
  ('game_bgg_356952', 356952, '終焉帝國', '終焉帝國'),
  ('game_bgg_292126', 292126, '掘跡藍星', '掘跡藍星'),
  ('game_bgg_71074', 71074, '西北航道', '西北航道'),
  ('game_bgg_318983', 318983, '法尤姆', '法尤姆'),
  ('game_bgg_385761', 385761, '遙遠之地', '遙遠之地'),
  ('game_bgg_32125', 32125, '袋中菲力貓', '袋中菲力貓'),
  ('game_bgg_352574', 352574, '動物日報', '動物日報'),
  ('game_attribute_import_fog_of_love', 175324, '愛霧', '愛霧'),
  ('game_bgg_287941', 287941, '台灣製茶錄', '台灣製茶錄'),
  ('game_bgg_197443', 197443, '神探緝凶', '神探緝凶'),
  ('game_bgg_128271', 128271, '銀杏城', '銀杏城'),
  ('game_bgg_200853', 200853, '野生動物園', '野生動物園'),
  ('game_bgg_414317', 414317, '和諧之森', '和諧之森'),
  ('game_bgg_253215', 253215, '瘋狂噴氣機', '瘋狂噴氣機'),
  ('game_bgg_394', 394, '魔法師', '魔法師'),
  ('game_bgg_107529', 107529, '王國建造者', '王國建造者'),
  ('game_bgg_410238', 410238, '邏輯與知識', '邏輯與知識'),
  ('game_bgg_301257', 301257, '磁浮地鐵', '磁浮地鐵'),
  ('game_bgg_258041', 258041, '馬約利卡', '馬約利卡'),
  ('game_bgg_338013', 338013, '馬拉開波：起義', '馬拉開波起義'),
  ('game_bgg_330403', 330403, '月球探險', '月球探險'),
  ('game_bgg_63975', 63975, '山羊爬山', '山羊爬山'),
  ('game_bgg_72287', 72287, '開膛手傑克口袋版', '開膛手傑克口袋版'),
  ('game_bgg_109969', 109969, '米寶超進化', '米寶超進化'),
  ('game_bgg_396790', 396790, '核子激盪', '核子激盪'),
  ('game_bgg_352695', 352695, '奧拉寧堡運河', '奧拉寧堡運河'),
  ('game_bgg_313807', 313807, '奧羅斯山', '奧羅斯山'),
  ('game_bgg_426229', 426229, '超擠停車場', '超擠停車場'),
  ('game_bgg_176887', 176887, '觀點', '觀點'),
  ('game_bgg_341974', 341974, '魔力植物', '魔力植物'),
  ('game_bgg_168232', 168232, '夢景計劃', '夢景計劃'),
  ('game_bgg_387780', 387780, '白鼠特攻隊', '白鼠特攻隊'),
  ('game_bgg_161417', 161417, '七變萬化', '七變萬化'),
  ('game_bgg_350637', 350637, '全軍出雞', '全軍出雞'),
  ('game_bgg_294230', 294230, '旅行之後', '旅行之後'),
  ('game_bgg_407297', 407297, '河谷玻璃坊', '河谷玻璃坊'),
  ('game_69f794b92d024a85984c31f3ba356ac2', 436116, '天空圖騰', '天空圖騰'),
  ('game_attribute_import_spring_meadow', 253684, '春泥物語', '春泥物語'),
  ('game_bgg_166384', 166384, '間諜危機', '間諜危機'),
  ('game_bgg_352892', 352892, '集郵收藏家', '集郵收藏家'),
  ('game_bgg_279720', 279720, '街道', '街道'),
  ('game_bgg_344258', 344258, '煞有其時', '煞有其時'),
  ('game_bgg_286063', 286063, '第七堡壘', '第七堡壘'),
  ('game_bgg_338460', 338460, '貓島紙筆版', '貓島紙筆版'),
  ('game_bgg_503', 503, '穿越沙漠', '穿越沙漠'),
  ('game_bgg_186475', 186475, '豆腐王國', '豆腐王國'),
  ('game_bgg_352454', 352454, '尋徑背包客', '尋徑背包客'),
  ('game_attribute_import_and_then_we_held_hands', 153999, '然後我們牽起手', '然後我們牽起手');

UPDATE games
SET english_name = COALESCE(NULLIF(TRIM(english_name), ''), display_name),
    display_name = (
      SELECT display_name
      FROM migration_0078_final_bgg_names
      WHERE game_id = games.id
    ),
    normalized_name = (
      SELECT normalized_name
      FROM migration_0078_final_bgg_names
      WHERE game_id = games.id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (SELECT game_id FROM migration_0078_final_bgg_names)
  AND display_name NOT GLOB '*[一-龥]*';

DROP TABLE migration_0078_final_bgg_names;

-- Make the updated names visible immediately to both compact catalog readers.
-- The normal scheduled rebuild remains the long-term maintenance path.
DELETE FROM game_catalog_snapshot_chunks;
DELETE FROM game_catalog_snapshot_state;

WITH ordered AS (
  SELECT entry_json,
    CAST((ROW_NUMBER() OVER (
      ORDER BY json_extract(entry_json, '$.displayName'), game_id
    ) - 1) / 1000 AS INTEGER) AS chunk_number
  FROM game_catalog_entries
  WHERE deleted = 0 AND entry_json IS NOT NULL
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS games_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 78, chunk_number, games_json FROM grouped;

INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 78, 0, '[]'
WHERE NOT EXISTS (SELECT 1 FROM game_catalog_snapshot_chunks WHERE generation = 78);

INSERT INTO game_catalog_snapshot_state (id, active_generation, through_version, chunk_count, generated_at)
SELECT 1, 78,
  (SELECT current_version FROM game_catalog_clock WHERE id = 1),
  COUNT(*),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM game_catalog_snapshot_chunks
WHERE generation = 78;

DELETE FROM attribute_catalog_snapshot_chunks;
DELETE FROM attribute_catalog_snapshot_state;

WITH source_entries AS (
  SELECT
    'subject:' || source.subject_id AS entry_key,
    json_set(
      source.entry_json,
      '$.values',
      json(COALESCE((
        SELECT json_group_array(json(value_json))
        FROM (
          SELECT json_object(
            'subjectId', state.subject_id,
            'attributeId', state.attribute_id,
            'score', state.score,
            'ratingDeviation', state.rating_deviation,
            'directAverage', CASE
              WHEN state.direct_count > 0 THEN state.direct_sum / state.direct_count
              ELSE NULL
            END,
            'directCount', state.direct_count,
            'comparisonCount', state.comparison_count,
            'decisiveComparisonCount', state.decisive_comparison_count,
            'evidenceCount', state.evidence_count,
            'modelVersion', state.model_version
          ) AS value_json
          FROM attribute_score_states state
          WHERE state.subject_id = source.subject_id
          ORDER BY state.attribute_id
        )
      ), '[]'))
    ) AS entry_json
  FROM attribute_subject_catalog_source source
  WHERE source.is_eligible = 1

  UNION ALL

  SELECT
    'candidate:' || candidate.id,
    json_object(
      'kind', 'candidate',
      'candidate', json_object(
        'id', candidate.id,
        'displayName', candidate.source_name,
        'values', json(candidate.values_json),
        'matchStatus', candidate.match_status,
        'subjectId', candidate.subject_id,
        'sourceRowNumber', candidate.source_row_number
      )
    )
  FROM attribute_import_candidates candidate
  WHERE candidate.match_status IN ('pending', 'ambiguous')
), ordered AS (
  SELECT entry_json,
    CAST((ROW_NUMBER() OVER (ORDER BY entry_key) - 1) / 100 AS INTEGER) AS chunk_number
  FROM source_entries
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS entries_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 78, chunk_number, entries_json
FROM grouped;

INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 78, 0, '[]'
WHERE NOT EXISTS (
  SELECT 1 FROM attribute_catalog_snapshot_chunks WHERE generation = 78
);

INSERT INTO attribute_catalog_snapshot_state
  (id, active_generation, through_version, chunk_count, attributes_json, score_model_version, generated_at)
SELECT
  1,
  78,
  (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
  COUNT(*),
  (
    SELECT json_group_array(json(attribute_json))
    FROM (
      SELECT json_object(
        'id', attribute.id,
        'key', attribute.key,
        'name', translation.name,
        'shortDescription', translation.short_description,
        'fullDescription', translation.full_description,
        'minValue', attribute.min_value,
        'maxValue', attribute.max_value,
        'sortOrder', attribute.sort_order
      ) AS attribute_json
      FROM attributes attribute
      JOIN attribute_translations translation
        ON translation.attribute_id = attribute.id
        AND translation.locale = 'zh-TW'
      WHERE attribute.is_active = 1
      ORDER BY attribute.sort_order, attribute.id
    )
  ),
  'glicko-rd-v1',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM attribute_catalog_snapshot_chunks
WHERE generation = 78;

PRAGMA optimize;
