-- The original columns remain only because rebuilding the users table would
-- affect every foreign key in the database. Their values are permanently
-- replaced with non-email placeholders; application identity uses email_hash.
UPDATE users
SET email = 'redacted-user:' || id,
    email_normalized = 'redacted-user:' || id;

-- Invitations created before email_hash existed cannot be matched without
-- retaining their full address. Revoke them so an admin can recreate them
-- under the protected representation.
UPDATE editor_invitations
SET revoked_at = COALESCE(revoked_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
WHERE email_hash IS NULL AND claimed_at IS NULL AND revoked_at IS NULL;

UPDATE editor_invitations
SET email_normalized = 'redacted-invite:' || id;

