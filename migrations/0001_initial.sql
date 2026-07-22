PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  granted_by TEXT REFERENCES users(id),
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (user_id, role)
);

CREATE INDEX idx_user_roles_active ON user_roles(user_id, revoked_at);

CREATE TABLE editor_invitations (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  invited_at INTEGER NOT NULL,
  claimed_by TEXT REFERENCES users(id),
  claimed_at INTEGER,
  revoked_at INTEGER
);

CREATE UNIQUE INDEX idx_editor_invitations_active_email
  ON editor_invitations(email_normalized, role)
  WHERE revoked_at IS NULL AND claimed_at IS NULL;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  english_name TEXT,
  normalized_name TEXT NOT NULL,
  merged_into_game_id TEXT REFERENCES games(id),
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_games_normalized_name ON games(normalized_name);
CREATE INDEX idx_games_updated_at ON games(updated_at DESC);

CREATE TABLE game_aliases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'alias',
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_game_aliases_unique ON game_aliases(game_id, normalized_alias);
CREATE INDEX idx_game_aliases_search ON game_aliases(normalized_alias, game_id);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  author_id TEXT REFERENCES users(id),
  idempotency_key TEXT,
  played_on TEXT,
  source_label TEXT,
  source_url TEXT,
  private_note TEXT,
  legacy_import_row_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_submissions_game ON submissions(game_id, created_at DESC);
CREATE UNIQUE INDEX idx_submissions_author_idempotency
  ON submissions(author_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id),
  statement TEXT NOT NULL,
  common_mistake TEXT,
  details TEXT,
  flow_stage TEXT NOT NULL DEFAULT 'uncategorized',
  player_count_note TEXT,
  edition_note TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden')),
  is_featured INTEGER NOT NULL DEFAULT 0,
  featured_order INTEGER,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hidden_at INTEGER,
  hidden_by TEXT REFERENCES users(id)
);

CREATE INDEX idx_rules_game_status ON rules(game_id, status, created_at DESC);
CREATE INDEX idx_rules_recent ON rules(status, created_at DESC);
CREATE INDEX idx_rules_featured ON rules(status, is_featured, featured_order);

CREATE TABLE rule_revisions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  previous_json TEXT NOT NULL,
  edited_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_rule_revisions_rule ON rule_revisions(rule_id, created_at DESC);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  source_filename TEXT NOT NULL,
  source_hash TEXT NOT NULL UNIQUE,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'imported', 'failed')),
  created_at INTEGER NOT NULL,
  imported_at INTEGER
);

CREATE TABLE legacy_import_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL,
  raw_game_name TEXT NOT NULL,
  raw_rule_text TEXT NOT NULL,
  raw_category TEXT,
  raw_source_label TEXT,
  raw_source_url TEXT,
  raw_timestamp TEXT,
  declared_rule_count INTEGER,
  proposed_rules_json TEXT NOT NULL DEFAULT '[]',
  matched_game_id TEXT REFERENCES games(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'imported', 'skipped')),
  created_at INTEGER NOT NULL,
  UNIQUE(batch_id, source_row_number)
);

CREATE INDEX idx_legacy_import_status ON legacy_import_rows(batch_id, status, source_row_number);
