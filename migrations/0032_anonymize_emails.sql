ALTER TABLE users ADD COLUMN email_hash TEXT;
ALTER TABLE users ADD COLUMN masked_email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash) WHERE email_hash IS NOT NULL;

ALTER TABLE editor_invitations ADD COLUMN email_hash TEXT;
ALTER TABLE editor_invitations ADD COLUMN masked_email TEXT;
ALTER TABLE editor_invitations ADD COLUMN note TEXT;
CREATE INDEX IF NOT EXISTS idx_editor_invitations_email_hash ON editor_invitations(email_hash) WHERE email_hash IS NOT NULL;
