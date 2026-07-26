ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN nickname_normalized TEXT;

CREATE UNIQUE INDEX idx_users_nickname_normalized
  ON users(nickname_normalized)
  WHERE nickname_normalized IS NOT NULL;
