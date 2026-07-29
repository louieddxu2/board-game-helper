PRAGMA foreign_keys = ON;

CREATE TABLE public_tag_catalog_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_version INTEGER NOT NULL
);

INSERT INTO public_tag_catalog_clock (id, current_version) VALUES (1, 0);

CREATE TABLE public_tag_catalog_entries (
  tag_id TEXT PRIMARY KEY,
  catalog_version INTEGER NOT NULL UNIQUE,
  entry_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL
);

WITH public_tags AS (
  SELECT
    t.id AS tag_id,
    ROW_NUMBER() OVER (ORDER BY t.id) AS catalog_version,
    json_object(
      'id', t.id,
      'slug', t.slug,
      'name', t.name,
      'isPublic', json('true'),
      'updatedAt', t.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = t.id ORDER BY alias)
      ), '[]'))
    ) AS entry_json,
    t.updated_at
  FROM tags t
  WHERE t.status = 'active' AND t.is_public = 1
)
INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
SELECT tag_id, catalog_version, entry_json, 0, updated_at FROM public_tags;

UPDATE public_tag_catalog_clock
SET current_version = COALESCE((SELECT MAX(catalog_version) FROM public_tag_catalog_entries), 0)
WHERE id = 1;

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
      'aliases', json('[]')
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
AFTER UPDATE OF slug, name, status, is_public, updated_at ON tags
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
      ), '[]'))
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

CREATE TRIGGER trg_public_tag_catalog_delete
AFTER DELETE ON tags
WHEN OLD.status = 'active' AND OLD.is_public = 1
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (OLD.id, (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1), NULL, 1, OLD.updated_at)
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
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
      ), '[]'))
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
      ), '[]'))
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
      ), '[]'))
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
