-- A configuration is named "<base game>＋<expansion label>". Imported BGG
-- expansions carry their full title, which repeats the base game
-- ("馬拉開波＋馬拉開波：起義") or is an English BGG title. Keep the label as the
-- concise user-facing expansion name used by the earlier configurations
-- ("奧丁的盛宴＋挪威人擴"); the full title stays on the expansion game row.

-- Existing BGG expansions: concise names derived from their existing Chinese aliases.
UPDATE attribute_subject_components
SET label = CASE game_id
  WHEN 'game_bgg_338013' THEN '起義擴'
  WHEN 'game_bgg_226441' THEN '茶與貿易擴'
  WHEN 'game_bgg_286287' THEN '偉大發現擴'
  WHEN 'game_bgg_366469' THEN '尼羅河擴'
END
WHERE component_type = 'expansion'
  AND game_id IN ('game_bgg_338013', 'game_bgg_226441', 'game_bgg_286287', 'game_bgg_366469')
  AND label IN ('馬拉開波：起義', 'Fields of Arle: Tea & Trade', 'Newton: Great Discoveries Expansion', 'Barrage: The Nile Affair Expansion');

-- New expansion components: drop a leading base-game name with its separator,
-- and give a Chinese name the same "擴" suffix as the other configuration labels.
DROP TRIGGER IF EXISTS attribute_subject_components_concise_expansion_label;
CREATE TRIGGER attribute_subject_components_concise_expansion_label
AFTER INSERT ON attribute_subject_components
WHEN NEW.component_type = 'expansion'
BEGIN
  UPDATE attribute_subject_components
  SET label = (
    SELECT CASE
      WHEN concise.name = '' THEN NEW.label
      WHEN concise.name GLOB '*[一-龥]*' AND instr(concise.name, '擴') = 0 THEN concise.name || '擴'
      ELSE concise.name
    END
    FROM (
      SELECT trim(CASE
        WHEN base.display_name IS NOT NULL AND length(NEW.label) > length(base.display_name)
          AND substr(NEW.label, 1, length(base.display_name)) = base.display_name
          AND substr(NEW.label, length(base.display_name) + 1, 1) IN ('：', ':', ' ', '-', '－', '—', '・')
          THEN ltrim(substr(NEW.label, length(base.display_name) + 2), ' ：:-－—・')
        WHEN base.english_name IS NOT NULL AND length(NEW.label) > length(base.english_name)
          AND lower(substr(NEW.label, 1, length(base.english_name))) = lower(base.english_name)
          AND substr(NEW.label, length(base.english_name) + 1, 1) IN ('：', ':', ' ', '-', '－', '—', '・')
          THEN ltrim(substr(NEW.label, length(base.english_name) + 2), ' ：:-－—・')
        ELSE NEW.label
      END) AS name
      FROM (SELECT 1) anchor
      LEFT JOIN attribute_subject_components base_component
        ON base_component.subject_id = NEW.subject_id AND base_component.component_type = 'base'
      LEFT JOIN games base ON base.id = base_component.game_id
      LIMIT 1
    ) concise
  )
  WHERE subject_id = NEW.subject_id
    AND component_order = NEW.component_order;
END;
