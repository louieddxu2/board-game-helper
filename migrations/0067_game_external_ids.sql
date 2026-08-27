-- Keep one canonical game row while allowing multiple external editions to
-- resolve to it. The existing games.bgg_id column remains the primary BGG ID;
-- this table is the source of truth whenever an edition has its own BGG ID.
CREATE TABLE game_external_ids (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('primary', 'edition')),
  created_at INTEGER NOT NULL,
  UNIQUE (source, external_id)
);

CREATE INDEX idx_game_external_ids_game_source
  ON game_external_ids(game_id, source, external_id);

-- Keep the attribute catalog's incremental clients aware of new BGG IDs
-- without waiting for the next weekly snapshot. Only existing attribute game
-- subjects get a delta; this must not create new searchable games.
CREATE TRIGGER game_external_ids_catalog_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
  AND EXISTS (
    SELECT 1 FROM attribute_subjects
    WHERE id = 'attribute_subject_game:' || NEW.game_id
  )
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:attribute_subject_game:' || NEW.game_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', s.id,
        'slug', s.slug,
        'kind', s.kind,
        'displayName', s.display_name,
        'gameId', s.game_id,
        'gameSlug', g.slug,
        'bggIds', json(COALESCE((
          SELECT json_group_array(CAST(e.external_id AS INTEGER))
          FROM game_external_ids e
          WHERE e.game_id = s.game_id AND e.source = 'bgg'
        ), '[]'))
      )
    ),
    0,
    NEW.created_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = 'attribute_subject_game:' || NEW.game_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

-- Identity rows are intentionally immutable in normal operation. If one is
-- removed, emit the remaining set so cached collection matching drops it.
CREATE TRIGGER game_external_ids_catalog_after_delete
AFTER DELETE ON game_external_ids
WHEN OLD.source = 'bgg'
  AND EXISTS (
    SELECT 1 FROM attribute_subjects
    WHERE id = 'attribute_subject_game:' || OLD.game_id
  )
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:attribute_subject_game:' || OLD.game_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', s.id,
        'slug', s.slug,
        'kind', s.kind,
        'displayName', s.display_name,
        'gameId', s.game_id,
        'gameSlug', g.slug,
        'bggIds', json(COALESCE((
          SELECT json_group_array(CAST(e.external_id AS INTEGER))
          FROM game_external_ids e
          WHERE e.game_id = s.game_id AND e.source = 'bgg'
        ), '[]'))
      )
    ),
    0,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = 'attribute_subject_game:' || OLD.game_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

-- Existing primary IDs are copied into the normalized mapping table first.
INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
SELECT
  'game-external:bgg:' || CAST(g.bgg_id AS TEXT),
  g.id,
  'bgg',
  CAST(g.bgg_id AS TEXT),
  'primary',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM games g
WHERE g.bgg_id IS NOT NULL;

-- Confirmed by the owner as the same canonical game despite edition-specific
-- BGG records. Do not create new games and do not promote an edition to the
-- single-valued games.bgg_id column.
INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
SELECT 'game-external:bgg:306881', 'game_a1c38db3091a9231100d', 'bgg', '306881', 'edition', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE EXISTS (SELECT 1 FROM games WHERE id = 'game_a1c38db3091a9231100d');
INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
SELECT 'game-external:bgg:306882', 'game_a1c38db3091a9231100d', 'bgg', '306882', 'edition', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE EXISTS (SELECT 1 FROM games WHERE id = 'game_a1c38db3091a9231100d');
INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
SELECT 'game-external:bgg:326538', 'game_35562d5e2703242be0ad', 'bgg', '326538', 'edition', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE EXISTS (SELECT 1 FROM games WHERE id = 'game_35562d5e2703242be0ad');
INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
SELECT 'game-external:bgg:276086', 'game_440369c78c3532781465', 'bgg', '276086', 'edition', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE EXISTS (SELECT 1 FROM games WHERE id = 'game_440369c78c3532781465');
INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
SELECT 'game-external:bgg:393179', 'game_5cf5b5d26d0f9e5b881b', 'bgg', '393179', 'edition', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE EXISTS (SELECT 1 FROM games WHERE id = 'game_5cf5b5d26d0f9e5b881b');

PRAGMA optimize;
