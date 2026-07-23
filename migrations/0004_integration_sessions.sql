ALTER TABLE sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'web';
ALTER TABLE sessions ADD COLUMN client_origin TEXT;

CREATE INDEX idx_sessions_user_kind ON sessions(user_id, session_kind, expires_at);
