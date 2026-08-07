-- Ordinary users may submit at most six pending rule contributions, including
-- edits proposed against already reviewed rules.
CREATE TRIGGER review_proposals_pending_rule_quota_before_insert
BEFORE INSERT ON review_proposals
WHEN NEW.operation = 'edit'
  AND NEW.status IN ('pending', 'conflict')
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = NEW.created_by AND role IN ('editor', 'admin') AND revoked_at IS NULL
  )
  AND (
    (SELECT COUNT(*) FROM rules
      WHERE created_by = NEW.created_by AND review_status = 'pending' AND status = 'published')
    +
    (SELECT COUNT(*) FROM review_proposals
      WHERE created_by = NEW.created_by AND operation = 'edit'
        AND status IN ('pending', 'conflict'))
  ) >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;

CREATE INDEX idx_review_proposals_author_pending
  ON review_proposals(created_by, operation, status, target_id);
