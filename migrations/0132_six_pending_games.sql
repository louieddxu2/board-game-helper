-- A general contributor may keep up to six games waiting for review, matching the six pending
-- rules. The cap still bounds games left behind when a contributor withdraws their rules.
DROP TRIGGER IF EXISTS games_pending_quota_before_insert;
DROP TRIGGER IF EXISTS games_pending_quota_before_update;

CREATE TRIGGER games_pending_quota_before_insert
BEFORE INSERT ON games
WHEN NEW.review_status = 'pending' AND NEW.visibility = 'public' AND NEW.merged_into_game_id IS NULL
  AND (SELECT COUNT(*) FROM games
       WHERE created_by = NEW.created_by
         AND review_status = 'pending' AND visibility = 'public'
         AND merged_into_game_id IS NULL) >= 6
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
         AND merged_into_game_id IS NULL) >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_game_limit');
END;
