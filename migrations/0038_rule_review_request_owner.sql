ALTER TABLE rules ADD COLUMN pending_review_by TEXT REFERENCES users(id);

CREATE INDEX idx_rules_pending_review_by
  ON rules(pending_review_by, review_status, status, id);

-- Existing quota triggers count the author of a new rule. For an edit to an
-- already reviewed rule, the quota belongs to the user requesting review.
DROP TRIGGER IF EXISTS rules_pending_quota_before_insert;
DROP TRIGGER IF EXISTS rules_pending_quota_before_update;

CREATE TRIGGER rules_pending_quota_before_insert
BEFORE INSERT ON rules
WHEN NEW.review_status = 'pending' AND NEW.status = 'published'
  AND NEW.pending_review_by IS NULL
  AND (SELECT COUNT(*) FROM rules
       WHERE created_by = NEW.created_by
         AND review_status = 'pending' AND status = 'published') >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;

CREATE TRIGGER rules_pending_quota_before_update
BEFORE UPDATE OF review_status, status, created_by, pending_review_by ON rules
WHEN NEW.review_status = 'pending' AND NEW.status = 'published'
  AND NEW.pending_review_by IS NULL
  AND NOT (OLD.review_status = 'pending' AND OLD.status = 'published' AND OLD.created_by IS NEW.created_by)
  AND (SELECT COUNT(*) FROM rules
       WHERE created_by = NEW.created_by
         AND review_status = 'pending' AND status = 'published') >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;

CREATE TRIGGER rules_pending_reviewer_quota_before_insert
BEFORE INSERT ON rules
WHEN NEW.review_status = 'pending' AND NEW.status = 'published'
  AND NEW.pending_review_by IS NOT NULL
  AND (SELECT COUNT(*) FROM rules
       WHERE (created_by = NEW.pending_review_by OR pending_review_by = NEW.pending_review_by)
         AND review_status = 'pending' AND status = 'published') >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;

CREATE TRIGGER rules_pending_reviewer_quota_before_update
BEFORE UPDATE OF review_status, status, pending_review_by ON rules
WHEN NEW.review_status = 'pending' AND NEW.status = 'published'
  AND NEW.pending_review_by IS NOT NULL
  AND NOT (OLD.review_status = 'pending' AND OLD.status = 'published'
    AND OLD.pending_review_by IS NEW.pending_review_by)
  AND (SELECT COUNT(*) FROM rules
       WHERE (created_by = NEW.pending_review_by OR pending_review_by = NEW.pending_review_by)
         AND review_status = 'pending' AND status = 'published') >= 6
BEGIN
  SELECT RAISE(ABORT, 'pending_rule_limit');
END;
