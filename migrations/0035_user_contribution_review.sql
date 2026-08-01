ALTER TABLE rules ADD COLUMN review_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (review_status IN ('not_required', 'pending', 'reviewed'));
ALTER TABLE rules ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE rules ADD COLUMN reviewed_by_nickname TEXT;
ALTER TABLE rules ADD COLUMN reviewed_at INTEGER;

ALTER TABLE games ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'hidden'));
ALTER TABLE games ADD COLUMN review_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (review_status IN ('not_required', 'pending', 'reviewed'));
ALTER TABLE games ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE games ADD COLUMN reviewed_by_nickname TEXT;
ALTER TABLE games ADD COLUMN reviewed_at INTEGER;

CREATE INDEX idx_rules_creator_pending_review
  ON rules(created_by, review_status, status, id);
CREATE INDEX idx_rules_game_pending_review
  ON rules(game_id, review_status, status, id);
CREATE INDEX idx_rules_reviewed_by
  ON rules(reviewed_by, id);
CREATE INDEX idx_games_creator_pending_review
  ON games(created_by, review_status, visibility, merged_into_game_id, id);
CREATE INDEX idx_games_reviewed_by
  ON games(reviewed_by, id);

-- The application checks quota first for a useful response. These triggers are
-- the final, race-safe guard for concurrent requests and direct D1 writes.
CREATE TRIGGER rules_pending_quota_before_insert
BEFORE INSERT ON rules
WHEN NEW.review_status = 'pending' AND NEW.status = 'published'
  AND (SELECT COUNT(*) FROM rules
       WHERE created_by = NEW.created_by
         AND review_status = 'pending' AND status = 'published') >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;

CREATE TRIGGER rules_pending_quota_before_update
BEFORE UPDATE OF review_status, status, created_by ON rules
WHEN NEW.review_status = 'pending' AND NEW.status = 'published'
  AND NOT (OLD.review_status = 'pending' AND OLD.status = 'published' AND OLD.created_by IS NEW.created_by)
  AND (SELECT COUNT(*) FROM rules
       WHERE created_by = NEW.created_by
         AND review_status = 'pending' AND status = 'published') >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;

CREATE TRIGGER games_pending_quota_before_insert
BEFORE INSERT ON games
WHEN NEW.review_status = 'pending' AND NEW.visibility = 'public' AND NEW.merged_into_game_id IS NULL
  AND (SELECT COUNT(*) FROM games
       WHERE created_by = NEW.created_by
         AND review_status = 'pending' AND visibility = 'public'
         AND merged_into_game_id IS NULL) >= 1
BEGIN
  SELECT RAISE(ABORT, 'pending_game_limit');
END;

CREATE TRIGGER games_pending_quota_before_update
BEFORE UPDATE OF review_status, visibility, merged_into_game_id, created_by ON games
WHEN NEW.review_status = 'pending' AND NEW.visibility = 'public' AND NEW.merged_into_game_id IS NULL
  AND NOT (OLD.review_status = 'pending' AND OLD.visibility = 'public'
    AND OLD.merged_into_game_id IS NULL AND OLD.created_by IS NEW.created_by)
  AND (SELECT COUNT(*) FROM games
       WHERE created_by = NEW.created_by
         AND review_status = 'pending' AND visibility = 'public'
         AND merged_into_game_id IS NULL) >= 1
BEGIN
  SELECT RAISE(ABORT, 'pending_game_limit');
END;

CREATE TRIGGER rules_review_status_before_insert
BEFORE INSERT ON rules
WHEN NEW.review_status <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = NEW.created_by AND role IN ('editor', 'admin') AND revoked_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'untrusted_rule_must_be_pending');
END;

CREATE TRIGGER games_review_status_before_insert
BEFORE INSERT ON games
WHEN NEW.review_status <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = NEW.created_by AND role IN ('editor', 'admin') AND revoked_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'untrusted_game_must_be_pending');
END;

-- Hidden games must disappear from the existing versioned public catalog.
DROP VIEW game_catalog_source;
CREATE VIEW game_catalog_source AS
SELECT g.id AS game_id,
  CASE WHEN g.merged_into_game_id IS NULL AND g.visibility = 'public' THEN 0 ELSE 1 END AS deleted,
  json_object(
    'id', g.id,
    'slug', g.slug,
    'displayName', g.display_name,
    'englishName', g.english_name,
    'aliases', json(COALESCE((
      SELECT json_group_array(alias)
      FROM (SELECT alias FROM game_aliases a WHERE a.game_id = g.id ORDER BY alias)
    ), '[]')),
    'ruleCount', g.published_rule_count,
    'publishedRuleCount', g.published_rule_count,
    'totalRuleCount', g.total_rule_count,
    'latestRuleUpdatedAt', g.latest_rule_updated_at,
    'updatedAt', g.updated_at
  ) AS entry_json,
  g.updated_at
FROM games g;

DROP TRIGGER game_catalog_games_after_update;
CREATE TRIGGER game_catalog_games_after_update
AFTER UPDATE OF slug, display_name, english_name, merged_into_game_id, visibility,
  published_rule_count, total_rule_count, latest_rule_updated_at ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
