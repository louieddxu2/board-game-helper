PRAGMA foreign_keys = ON;

-- One non-login identity retains attribution for public content after its owner
-- deletes their account. Reusing one row avoids accumulating one tombstone user
-- per deletion and releases the original Google subject and email for signup.
INSERT OR IGNORE INTO users (
  id, google_sub, email, email_normalized, email_verified,
  display_name, avatar_url, created_at, last_login_at,
  nickname, nickname_normalized, show_nickname
) VALUES (
  'usr_deleted', 'account-deletion-tombstone',
  'deleted-account@invalid.local', 'deleted-account@invalid.local', 0,
  '已刪除帳號', NULL, 0, 0, '已刪除帳號', '已刪除帳號', 1
);

-- Account deletion must only visit rows connected to that account.
CREATE INDEX IF NOT EXISTS idx_rule_revisions_edited_by
  ON rule_revisions(edited_by, rule_id);
CREATE INDEX IF NOT EXISTS idx_tags_created_by
  ON tags(created_by, id);
CREATE INDEX IF NOT EXISTS idx_rule_tags_created_by
  ON rule_tags(created_by, rule_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_games_created_by
  ON games(created_by, id);
CREATE INDEX IF NOT EXISTS idx_games_rename_owner
  ON games(rename_owner_id, id);
CREATE INDEX IF NOT EXISTS idx_submissions_author
  ON submissions(author_id, id);
CREATE INDEX IF NOT EXISTS idx_rules_submission_id
  ON rules(submission_id, id);
CREATE INDEX IF NOT EXISTS idx_rules_hidden_by
  ON rules(hidden_by, id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions(user_id, id_hash);
CREATE INDEX IF NOT EXISTS idx_user_roles_granted_by
  ON user_roles(granted_by, user_id);
CREATE INDEX IF NOT EXISTS idx_editor_invitations_invited_by
  ON editor_invitations(invited_by, id);
CREATE INDEX IF NOT EXISTS idx_editor_invitations_claimed_by
  ON editor_invitations(claimed_by, id);
CREATE INDEX IF NOT EXISTS idx_review_batches_created_by
  ON review_batches(created_by, id);
CREATE INDEX IF NOT EXISTS idx_review_proposals_created_by
  ON review_proposals(created_by, id);
CREATE INDEX IF NOT EXISTS idx_review_proposals_reviewed_by
  ON review_proposals(reviewed_by, id);
CREATE INDEX IF NOT EXISTS idx_user_roles_active_role
  ON user_roles(role, user_id)
  WHERE revoked_at IS NULL;

-- Protect the site even if account deletion is invoked outside the HTTP route.
CREATE TRIGGER IF NOT EXISTS users_prevent_last_admin_delete
BEFORE DELETE ON users
WHEN OLD.id <> 'usr_deleted'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = OLD.id AND role = 'admin' AND revoked_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE role = 'admin' AND revoked_at IS NULL AND user_id <> OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'last_admin_account');
END;
