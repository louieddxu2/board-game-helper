-- Count reviewer-owned pending rules through the existing creator and reviewer
-- indexes. The second count excludes rules already counted by creator.
DROP TRIGGER IF EXISTS rules_pending_reviewer_quota_before_insert;
DROP TRIGGER IF EXISTS rules_pending_reviewer_quota_before_update;

CREATE TRIGGER rules_pending_reviewer_quota_before_insert
BEFORE INSERT ON rules
WHEN NEW.review_status = 'pending' AND NEW.status = 'published'
  AND NEW.pending_review_by IS NOT NULL
  AND (
    (SELECT COUNT(*) FROM rules
     WHERE created_by = NEW.pending_review_by
       AND review_status = 'pending' AND status = 'published')
    +
    (SELECT COUNT(*) FROM rules
     WHERE pending_review_by = NEW.pending_review_by
       AND created_by IS NOT NEW.pending_review_by
       AND review_status = 'pending' AND status = 'published')
  ) >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;

-- Keep the existing role index but make the active-admin predicate part of
-- its search key. Revoked admin roles cannot lengthen the last-admin check.
DROP INDEX idx_user_roles_active_role;
CREATE INDEX idx_user_roles_active_role
  ON user_roles(role, revoked_at, user_id);

CREATE TRIGGER rules_pending_reviewer_quota_before_update
BEFORE UPDATE OF review_status, status, pending_review_by ON rules
WHEN NEW.review_status = 'pending' AND NEW.status = 'published'
  AND NEW.pending_review_by IS NOT NULL
  AND NOT (OLD.review_status = 'pending' AND OLD.status = 'published'
    AND OLD.pending_review_by IS NEW.pending_review_by)
  AND (
    (SELECT COUNT(*) FROM rules
     WHERE created_by = NEW.pending_review_by
       AND review_status = 'pending' AND status = 'published')
    +
    (SELECT COUNT(*) FROM rules
     WHERE pending_review_by = NEW.pending_review_by
       AND created_by IS NOT NEW.pending_review_by
       AND review_status = 'pending' AND status = 'published')
  ) >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;

-- A game's rules can have three statuses. Read the newest index entry for
-- each status instead of scanning every rule belonging to the game.
DROP TRIGGER IF EXISTS rules_stats_after_delete;
DROP TRIGGER IF EXISTS rules_stats_after_move_old_game;

CREATE TRIGGER rules_stats_after_delete
AFTER DELETE ON rules
BEGIN
  UPDATE games
  SET published_rule_count = MAX(0, published_rule_count - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END),
      total_rule_count = MAX(0, total_rule_count - 1),
      latest_rule_updated_at = (
        SELECT MAX(candidate) FROM (
          SELECT (SELECT updated_at FROM rules
                  WHERE game_id = OLD.game_id AND status = 'draft'
                  ORDER BY updated_at DESC LIMIT 1) AS candidate
          UNION ALL
          SELECT (SELECT updated_at FROM rules
                  WHERE game_id = OLD.game_id AND status = 'published'
                  ORDER BY updated_at DESC LIMIT 1)
          UNION ALL
          SELECT (SELECT updated_at FROM rules
                  WHERE game_id = OLD.game_id AND status = 'hidden'
                  ORDER BY updated_at DESC LIMIT 1)
        )
      )
  WHERE id = OLD.game_id;
END;

CREATE TRIGGER rules_stats_after_move_old_game
AFTER UPDATE OF game_id ON rules
WHEN OLD.game_id <> NEW.game_id
BEGIN
  UPDATE games
  SET published_rule_count = MAX(0, published_rule_count - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END),
      total_rule_count = MAX(0, total_rule_count - 1),
      latest_rule_updated_at = (
        SELECT MAX(candidate) FROM (
          SELECT (SELECT updated_at FROM rules
                  WHERE game_id = OLD.game_id AND status = 'draft'
                  ORDER BY updated_at DESC LIMIT 1) AS candidate
          UNION ALL
          SELECT (SELECT updated_at FROM rules
                  WHERE game_id = OLD.game_id AND status = 'published'
                  ORDER BY updated_at DESC LIMIT 1)
          UNION ALL
          SELECT (SELECT updated_at FROM rules
                  WHERE game_id = OLD.game_id AND status = 'hidden'
                  ORDER BY updated_at DESC LIMIT 1)
        )
      )
  WHERE id = OLD.game_id;
END;
