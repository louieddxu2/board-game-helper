PRAGMA foreign_keys = ON;

ALTER TABLE rules ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories_json));
ALTER TABLE tags ADD COLUMN category_hints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(category_hints_json));
ALTER TABLE tags ADD COLUMN detection_keywords_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(detection_keywords_json));

UPDATE tags SET category_hints_json = '["teaching_setup_opening"]' WHERE id = 'tag_stage_setup';
UPDATE tags SET category_hints_json = '["action_effect_detail"]' WHERE id = 'tag_stage_action';
UPDATE tags SET category_hints_json = '["flow_endgame_scoring"]' WHERE id IN ('tag_stage_round', 'tag_stage_end_scoring');

UPDATE public_tag_catalog_entries
SET entry_json = json_set(
  entry_json,
  '$.categoryHints',
  json(COALESCE((SELECT category_hints_json FROM tags WHERE tags.id = public_tag_catalog_entries.tag_id), '[]')),
  '$.detectionKeywords',
  json(COALESCE((SELECT detection_keywords_json FROM tags WHERE tags.id = public_tag_catalog_entries.tag_id), '[]'))
)
WHERE deleted = 0 AND entry_json IS NOT NULL;

DROP TRIGGER trg_public_tag_catalog_insert;
DROP TRIGGER trg_public_tag_catalog_update;
DROP TRIGGER trg_public_tag_catalog_alias_insert;
DROP TRIGGER trg_public_tag_catalog_alias_delete;
DROP TRIGGER trg_public_tag_catalog_alias_update;

CREATE TRIGGER trg_public_tag_catalog_insert
AFTER INSERT ON tags
WHEN NEW.status = 'active' AND NEW.is_public = 1
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    NEW.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    json_object(
      'id', NEW.id,
      'slug', NEW.slug,
      'name', NEW.name,
      'isPublic', json('true'),
      'updatedAt', NEW.updated_at,
      'aliases', json('[]'),
      'categoryHints', json(COALESCE(NEW.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(NEW.detection_keywords_json, '[]'))
    ),
    0,
    NEW.updated_at
  )
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = 0,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_public_tag_catalog_update
AFTER UPDATE OF slug, name, status, is_public, updated_at, category_hints_json, detection_keywords_json ON tags
WHEN (OLD.status = 'active' AND OLD.is_public = 1)
  OR (NEW.status = 'active' AND NEW.is_public = 1)
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    NEW.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    CASE WHEN NEW.status = 'active' AND NEW.is_public = 1 THEN json_object(
      'id', NEW.id,
      'slug', NEW.slug,
      'name', NEW.name,
      'isPublic', json('true'),
      'updatedAt', NEW.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = NEW.id ORDER BY alias)
      ), '[]')),
      'categoryHints', json(COALESCE(NEW.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(NEW.detection_keywords_json, '[]'))
    ) ELSE NULL END,
    CASE WHEN NEW.status = 'active' AND NEW.is_public = 1 THEN 0 ELSE 1 END,
    NEW.updated_at
  )
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_public_tag_catalog_alias_insert
AFTER INSERT ON tag_aliases
WHEN EXISTS (SELECT 1 FROM tags WHERE id = NEW.tag_id AND status = 'active' AND is_public = 1)
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  SELECT
    t.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    json_object(
      'id', t.id,
      'slug', t.slug,
      'name', t.name,
      'isPublic', json('true'),
      'updatedAt', t.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = t.id ORDER BY alias)
      ), '[]')),
      'categoryHints', json(COALESCE(t.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(t.detection_keywords_json, '[]'))
    ),
    0,
    t.updated_at
  FROM tags t WHERE t.id = NEW.tag_id
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = 0,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_public_tag_catalog_alias_delete
AFTER DELETE ON tag_aliases
WHEN EXISTS (SELECT 1 FROM tags WHERE id = OLD.tag_id AND status = 'active' AND is_public = 1)
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  SELECT
    t.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    json_object(
      'id', t.id,
      'slug', t.slug,
      'name', t.name,
      'isPublic', json('true'),
      'updatedAt', t.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = t.id ORDER BY alias)
      ), '[]')),
      'categoryHints', json(COALESCE(t.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(t.detection_keywords_json, '[]'))
    ),
    0,
    t.updated_at
  FROM tags t WHERE t.id = OLD.tag_id
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = 0,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_public_tag_catalog_alias_update
AFTER UPDATE OF alias, normalized_alias ON tag_aliases
WHEN EXISTS (SELECT 1 FROM tags WHERE id = NEW.tag_id AND status = 'active' AND is_public = 1)
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  SELECT
    t.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    json_object(
      'id', t.id,
      'slug', t.slug,
      'name', t.name,
      'isPublic', json('true'),
      'updatedAt', t.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = t.id ORDER BY alias)
      ), '[]')),
      'categoryHints', json(COALESCE(t.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(t.detection_keywords_json, '[]'))
    ),
    0,
    t.updated_at
  FROM tags t WHERE t.id = NEW.tag_id
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = 0,
    updated_at = excluded.updated_at;
END;
