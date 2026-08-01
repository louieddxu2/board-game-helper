-- Legacy hashes used a public salt and cannot be converted to HMAC without the
-- original address. Accounts repopulate the protected hash on their next login.
UPDATE users
SET email_hash = NULL
WHERE id <> 'usr_deleted';

-- Claimed or revoked invitations no longer need an email identifier. Active
-- legacy invitations remain claimable during the HMAC transition.
UPDATE editor_invitations
SET email_hash = NULL,
    masked_email = NULL
WHERE claimed_at IS NOT NULL OR revoked_at IS NOT NULL;

-- Keep the newest active row if earlier application races created duplicates.
UPDATE editor_invitations
SET revoked_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (PARTITION BY email_hash ORDER BY invited_at DESC, id DESC) AS duplicate_rank
    FROM editor_invitations
    WHERE email_hash IS NOT NULL AND claimed_at IS NULL AND revoked_at IS NULL
  )
  WHERE duplicate_rank > 1
);

DROP INDEX IF EXISTS idx_editor_invitations_email_hash;
CREATE UNIQUE INDEX idx_editor_invitations_active_email_hash
  ON editor_invitations(email_hash)
  WHERE email_hash IS NOT NULL AND claimed_at IS NULL AND revoked_at IS NULL;

CREATE TRIGGER user_roles_prevent_last_admin_revoke
BEFORE UPDATE OF revoked_at ON user_roles
WHEN OLD.role = 'admin'
  AND OLD.revoked_at IS NULL
  AND NEW.revoked_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE role = 'admin' AND revoked_at IS NULL AND user_id <> OLD.user_id
  )
BEGIN
  SELECT RAISE(ABORT, 'last_admin_role');
END;

CREATE TRIGGER user_roles_prevent_last_admin_delete
BEFORE DELETE ON user_roles
WHEN OLD.role = 'admin'
  AND OLD.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE role = 'admin' AND revoked_at IS NULL AND user_id <> OLD.user_id
  )
BEGIN
  SELECT RAISE(ABORT, 'last_admin_role');
END;
