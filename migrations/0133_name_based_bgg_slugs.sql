-- Games imported from BGG were given addresses like /games/bgg-283948. Give them readable
-- addresses from their English name (or their display name), like the slugs the site creates
-- for new games: lowercase, words joined by hyphens, at most 64 characters. Few people have used
-- the old addresses yet, so they are not kept. Changing a slug already advances the game catalog
-- through game_catalog_outbox_games_after_update, so cached catalogs pick up the new links.
CREATE TABLE migration_0133_bgg_slugs (
  game_id TEXT PRIMARY KEY,
  bgg_id INTEGER NOT NULL,
  base TEXT NOT NULL,
  slug TEXT
);

INSERT INTO migration_0133_bgg_slugs (game_id, bgg_id, base)
SELECT id, coalesce(bgg_id, CAST(substr(slug, 5) AS INTEGER)),
  -- SQLite has no regular expressions: map the accents in imported names to ASCII (including a
  -- Cyrillic 'с' that looks like a Latin 'c'), then separators to hyphens.
  lower(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      trim(coalesce(nullif(trim(english_name), ''), display_name)),
      'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'), 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ä', 'a'), 'ã', 'a'), 'å', 'a'),
      'ó', 'o'), 'ò', 'o'), 'ô', 'o'), 'ö', 'o'), 'õ', 'o'), 'ú', 'u'), 'ù', 'u'), 'û', 'u'), 'ü', 'u'), 'í', 'i'),
      'ì', 'i'), 'î', 'i'), 'ï', 'i'), 'ñ', 'n'), 'ç', 'c'), 'É', 'e'), 'Ö', 'o'), 'Ü', 'u'), ' ', '-'), ':', '-'),
      '&', '-'), '''', ''), '’', ''), '.', '-'), ',', '-'), '!', '-'), '?', '-'), '(', '-'), ')', '-'), '/', '-'),
      '"', '-'), '+', '-'), '–', '-'), '—', '-'), '#', '-'), '_', '-'), ';', '-'), 'ộ', 'o'), 'ố', 'o'), 'с', 'c')
  )
FROM games
-- An edition merged into another BGG id can keep the old number in its slug.
WHERE slug GLOB 'bgg-[0-9]*';

-- Collapse runs of hyphens (each pass halves the longest run) and trim them from both ends.
UPDATE migration_0133_bgg_slugs SET base = replace(base, '--', '-');
UPDATE migration_0133_bgg_slugs SET base = replace(base, '--', '-');
UPDATE migration_0133_bgg_slugs SET base = replace(base, '--', '-');
UPDATE migration_0133_bgg_slugs SET base = replace(base, '--', '-');
UPDATE migration_0133_bgg_slugs SET base = replace(base, '--', '-');
UPDATE migration_0133_bgg_slugs SET base = trim(substr(trim(base, '-'), 1, 64), '-');

-- A name shared by several games, or already used by another game, keeps its BGG id as a suffix.
UPDATE migration_0133_bgg_slugs
SET slug = CASE
  WHEN base = '' THEN 'game-' || CAST(bgg_id AS TEXT)
  WHEN (SELECT COUNT(*) FROM migration_0133_bgg_slugs other WHERE other.base = migration_0133_bgg_slugs.base) > 1
    OR EXISTS (SELECT 1 FROM games taken WHERE taken.slug = migration_0133_bgg_slugs.base AND taken.id <> migration_0133_bgg_slugs.game_id)
    THEN base || '-' || CAST(bgg_id AS TEXT)
  ELSE base
END;

UPDATE games
SET slug = (SELECT slug FROM migration_0133_bgg_slugs renamed WHERE renamed.game_id = games.id),
  updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (SELECT game_id FROM migration_0133_bgg_slugs);

DROP TABLE migration_0133_bgg_slugs;
