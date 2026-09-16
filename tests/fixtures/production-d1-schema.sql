PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
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
, nickname TEXT, nickname_normalized TEXT, show_nickname INTEGER NOT NULL DEFAULT 0, email_hash TEXT, masked_email TEXT);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  granted_by TEXT REFERENCES users(id),
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (user_id, role)
);
CREATE TABLE editor_invitations (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  invited_at INTEGER NOT NULL,
  claimed_by TEXT REFERENCES users(id),
  claimed_at INTEGER,
  revoked_at INTEGER
, email_hash TEXT, masked_email TEXT, note TEXT);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
, session_kind TEXT NOT NULL DEFAULT 'web', client_origin TEXT);
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
, published_rule_count INTEGER NOT NULL DEFAULT 0, total_rule_count INTEGER NOT NULL DEFAULT 0, latest_rule_updated_at INTEGER, rename_owner_id TEXT REFERENCES users(id), rename_locked INTEGER NOT NULL DEFAULT 0, visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'hidden')), review_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (review_status IN ('not_required', 'pending', 'reviewed')), reviewed_by TEXT REFERENCES users(id), reviewed_by_nickname TEXT, reviewed_at INTEGER, attribute_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (attribute_enabled IN (0, 1)), bgg_id INTEGER
  CHECK (bgg_id IS NULL OR bgg_id > 0), entity_kind TEXT NOT NULL DEFAULT 'base'
  CHECK (entity_kind IN ('base', 'expansion', 'version', 'unknown')));
CREATE TABLE game_aliases (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'alias',
  created_at INTEGER NOT NULL
);
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  author_id TEXT REFERENCES users(id),
  idempotency_key TEXT,
  source_label TEXT,
  source_url TEXT,
  legacy_import_row_id TEXT,
  source_notes TEXT);
CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id),
  statement TEXT NOT NULL,
  common_mistake TEXT,
  details TEXT,
  flow_stage TEXT NOT NULL DEFAULT 'uncategorized',
  edition_note TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden')),
  is_featured INTEGER NOT NULL DEFAULT 0,
  featured_order INTEGER,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hidden_at INTEGER,
  hidden_by TEXT REFERENCES users(id)
, tag_ids_json TEXT NOT NULL DEFAULT '[]', source_label TEXT, source_url TEXT, player_counts_json TEXT NOT NULL DEFAULT '[]', edition_notes_json TEXT NOT NULL DEFAULT '[]', editor_ids_json TEXT NOT NULL DEFAULT '[]', categories_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories_json)), importance_count INTEGER NOT NULL DEFAULT 0 CHECK (importance_count >= 0), review_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (review_status IN ('not_required', 'pending', 'reviewed')), reviewed_by TEXT REFERENCES users(id), reviewed_by_nickname TEXT, reviewed_at INTEGER, pending_review_by TEXT REFERENCES users(id));
CREATE TABLE rule_revisions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  previous_json TEXT NOT NULL,
  edited_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at INTEGER NOT NULL
);
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
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  tag_type TEXT NOT NULL DEFAULT 'topic' CHECK (tag_type IN ('topic')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'hidden')),
  merged_into_tag_id TEXT REFERENCES tags(id),
  created_by TEXT REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'suggested')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, is_public INTEGER NOT NULL DEFAULT 0, category_hints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(category_hints_json)), detection_keywords_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(detection_keywords_json)));
CREATE TABLE tag_aliases (
  id TEXT PRIMARY KEY,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE rule_tags (
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rule_id, tag_id)
);
CREATE TABLE submission_sources (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  label TEXT,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE review_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('file', 'ai', 'manual')),
  source_hash TEXT UNIQUE,
  base_dataset_version TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  proposal_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE review_proposals (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES review_batches(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL DEFAULT 'rule' CHECK (target_type IN ('rule')),
  target_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  operation TEXT NOT NULL DEFAULT 'edit' CHECK (operation IN ('edit', 'hide')),
  base_updated_at INTEGER NOT NULL,
  base_content_hash TEXT NOT NULL,
  original_json TEXT NOT NULL,
  proposed_json TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'conflict', 'cancelled')),
  claimed_by TEXT REFERENCES users(id),
  claimed_until INTEGER,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE game_search_catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  catalog_date TEXT NOT NULL,
  games_json TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
CREATE TABLE game_catalog_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_version INTEGER NOT NULL
);
CREATE TABLE game_catalog_entries (
  game_id TEXT PRIMARY KEY,
  catalog_version INTEGER NOT NULL UNIQUE,
  entry_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE game_catalog_snapshot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_generation INTEGER NOT NULL,
  through_version INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);
CREATE TABLE game_catalog_snapshot_chunks (
  generation INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  games_json TEXT NOT NULL,
  PRIMARY KEY (generation, chunk_number)
);
CREATE TABLE public_tag_catalog_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_version INTEGER NOT NULL
);
CREATE TABLE public_tag_catalog_entries (
  tag_id TEXT PRIMARY KEY,
  catalog_version INTEGER NOT NULL UNIQUE,
  entry_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE user_game_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seen_rule_updated_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE game_public_rule_heads (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE game_view_dedup (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  view_date TEXT NOT NULL,
  view_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, view_date, view_key)
);
CREATE TABLE game_daily_view_counts (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  view_date TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_view_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, view_date)
);
CREATE TABLE rule_importance_votes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, rule_id)
) WITHOUT ROWID;
CREATE TABLE game_external_resources (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('teaching', 'help_card', 'faq')),
  url TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE attribute_subjects (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('game', 'configuration')),
  display_name TEXT NOT NULL, game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE attribute_subject_components (
  subject_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  component_order INTEGER NOT NULL, game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  component_type TEXT NOT NULL CHECK (component_type IN ('base', 'expansion', 'label')),
  label TEXT NOT NULL, bgg_id INTEGER
  CHECK (bgg_id IS NULL OR bgg_id > 0), english_name TEXT, PRIMARY KEY (subject_id, component_order)
);
CREATE TABLE attributes (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, category TEXT,
  min_value INTEGER NOT NULL DEFAULT 0, max_value INTEGER NOT NULL DEFAULT 10,
  is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL
, random_key TEXT NOT NULL DEFAULT '', scale_type TEXT NOT NULL DEFAULT 'unipolar'
  CHECK (scale_type IN ('unipolar', 'bipolar')));
CREATE TABLE attribute_translations (
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  locale TEXT NOT NULL, name TEXT NOT NULL, short_description TEXT, full_description TEXT, min_example TEXT, max_example TEXT, endpoints_json TEXT
  CHECK (endpoints_json IS NULL OR (json_valid(endpoints_json) AND json_type(endpoints_json) = 'object')),
  PRIMARY KEY (attribute_id, locale)
);
CREATE TABLE attribute_ratings (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value >= 0 AND value <= 10), actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (session_id, subject_id, attribute_id)
);
CREATE TABLE attribute_comparisons (
  id TEXT PRIMARY KEY, attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  subject_a_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  subject_b_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  result TEXT NOT NULL CHECK (result IN ('A_HIGHER', 'SIMILAR', 'B_HIGHER')),
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK (subject_a_id <> subject_b_id),
  UNIQUE (session_id, attribute_id, subject_a_id, subject_b_id)
);
CREATE TABLE attribute_import_candidates (
  id TEXT PRIMARY KEY, source_name TEXT NOT NULL, values_json TEXT NOT NULL,
  source_spreadsheet_id TEXT NOT NULL, source_sheet_name TEXT NOT NULL, source_row_number INTEGER NOT NULL,
  match_status TEXT NOT NULL CHECK (match_status IN ('pending', 'matched', 'ambiguous', 'skipped')),
  subject_id TEXT REFERENCES attribute_subjects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE attribute_vote_events (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rating', 'comparison')),
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  subject_a_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  subject_b_id TEXT REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  value REAL,
  result TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (response_id, event_key),
  CHECK (
    (kind = 'rating' AND subject_b_id IS NULL AND value IS NOT NULL AND value >= 0 AND value <= 10 AND result IS NULL)
    OR
    (kind = 'comparison' AND subject_b_id IS NOT NULL AND value IS NULL AND result IN ('A_HIGHER', 'SIMILAR', 'B_HIGHER'))
  )
);
CREATE TABLE attribute_score_states (
  subject_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  score REAL NOT NULL DEFAULT 5 CHECK (score >= 0 AND score <= 10),
  direct_sum REAL NOT NULL DEFAULT 0,
  direct_count INTEGER NOT NULL DEFAULT 0 CHECK (direct_count >= 0),
  comparison_count INTEGER NOT NULL DEFAULT 0 CHECK (comparison_count >= 0),
  decisive_comparison_count INTEGER NOT NULL DEFAULT 0 CHECK (decisive_comparison_count >= 0),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  model_version TEXT NOT NULL DEFAULT 'bounded-k-elo-v1',
  updated_at INTEGER NOT NULL, rating_deviation REAL NOT NULL DEFAULT 3, random_key TEXT NOT NULL DEFAULT '', question_slot INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (subject_id, attribute_id)
);
CREATE TABLE attribute_pair_stats (
  subject_a_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  subject_b_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  comparison_count INTEGER NOT NULL DEFAULT 0 CHECK (comparison_count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subject_a_id, subject_b_id, attribute_id),
  CHECK (subject_a_id < subject_b_id)
);
CREATE TABLE attribute_activity_feed (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
ANALYZE sqlite_schema;
CREATE TABLE attribute_vote_lock (
  lock_name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE attribute_catalog_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_version INTEGER NOT NULL
);
CREATE TABLE attribute_catalog_entries (
  entry_key TEXT PRIMARY KEY,
  catalog_version INTEGER NOT NULL UNIQUE,
  entry_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE attribute_catalog_snapshot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_generation INTEGER NOT NULL,
  through_version INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  attributes_json TEXT NOT NULL,
  score_model_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
CREATE TABLE attribute_catalog_snapshot_chunks (
  generation INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  entries_json TEXT NOT NULL,
  PRIMARY KEY (generation, chunk_number)
);
CREATE TABLE attribute_vote_responses (
  response_id TEXT NOT NULL PRIMARY KEY,
  attribute_id TEXT REFERENCES attributes(id) ON DELETE SET NULL,
  subject_a_id TEXT REFERENCES attribute_subjects(id) ON DELETE SET NULL,
  subject_b_id TEXT REFERENCES attribute_subjects(id) ON DELETE SET NULL,
  rating_a REAL,
  rating_b REAL,
  comparison TEXT CHECK (comparison IS NULL OR comparison IN ('A_HIGHER', 'SIMILAR', 'B_HIGHER')),
  activity_json TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, question_high_pole TEXT NOT NULL DEFAULT 'high'
  CHECK (question_high_pole IN ('low', 'high')),
  CHECK (rating_a IS NULL OR (rating_a >= 0 AND rating_a <= 10)),
  CHECK (rating_b IS NULL OR (rating_b >= 0 AND rating_b <= 10))
);
CREATE TABLE attribute_merge_rebuild_jobs (
  id TEXT PRIMARY KEY,
  source_game_id TEXT NOT NULL REFERENCES games(id),
  target_game_id TEXT NOT NULL REFERENCES games(id),
  source_subject_id TEXT NOT NULL REFERENCES attribute_subjects(id),
  target_subject_id TEXT NOT NULL REFERENCES attribute_subjects(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  reset_completed INTEGER NOT NULL DEFAULT 0 CHECK (reset_completed IN (0, 1)),
  cursor_created_at INTEGER NOT NULL DEFAULT -1,
  cursor_stream_id TEXT NOT NULL DEFAULT '',
  cutoff_created_at INTEGER NOT NULL,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, attribute_id TEXT REFERENCES attributes(id));
CREATE TABLE attribute_subject_component_aliases (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  component_order INTEGER NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subject_id, component_order)
    REFERENCES attribute_subject_components(subject_id, component_order)
    ON DELETE CASCADE
);
CREATE TABLE game_external_ids (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('primary', 'edition')),
  created_at INTEGER NOT NULL,
  UNIQUE (source, external_id)
);
CREATE TABLE rule_game_variants (
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rule_id, game_id)
);
CREATE TABLE game_entity_relations (
  id TEXT PRIMARY KEY,
  source_game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  target_game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('expansion_of', 'version_of', 'variant_of')),
  created_at INTEGER NOT NULL,
  UNIQUE (source_game_id, target_game_id, relation_type),
  CHECK (source_game_id <> target_game_id)
);
CREATE TABLE attribute_catalog_rebuild_mode (id INTEGER PRIMARY KEY CHECK (id = 1));
DELETE FROM sqlite_sequence;
CREATE INDEX idx_user_roles_active ON user_roles(user_id, revoked_at);
CREATE UNIQUE INDEX idx_editor_invitations_active_email
  ON editor_invitations(email_normalized, role)
  WHERE revoked_at IS NULL AND claimed_at IS NULL;
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX idx_games_normalized_name ON games(normalized_name);
CREATE INDEX idx_games_updated_at ON games(updated_at DESC);
CREATE UNIQUE INDEX idx_game_aliases_unique ON game_aliases(game_id, normalized_alias);
CREATE INDEX idx_game_aliases_search ON game_aliases(normalized_alias, game_id);
CREATE UNIQUE INDEX idx_submissions_author_idempotency
  ON submissions(author_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_rules_game_status ON rules(game_id, status, created_at DESC);
CREATE INDEX idx_rules_recent ON rules(status, created_at DESC);
CREATE INDEX idx_rules_featured ON rules(status, is_featured, featured_order);
CREATE INDEX idx_rule_revisions_rule ON rule_revisions(rule_id, created_at DESC);
CREATE INDEX idx_legacy_import_status ON legacy_import_rows(batch_id, status, source_row_number);
CREATE INDEX idx_tags_name ON tags(name);
CREATE INDEX idx_tag_aliases_tag ON tag_aliases(tag_id);
CREATE INDEX idx_rule_tags_tag ON rule_tags(tag_id, rule_id);
CREATE UNIQUE INDEX idx_submission_sources_unique
  ON submission_sources(submission_id, url);
CREATE INDEX idx_submission_sources_submission
  ON submission_sources(submission_id, position);
CREATE INDEX idx_sessions_user_kind ON sessions(user_id, session_kind, expires_at);
CREATE INDEX idx_review_batches_status
  ON review_batches(status, updated_at DESC);
CREATE UNIQUE INDEX idx_review_proposals_batch_target
  ON review_proposals(batch_id, target_id, base_content_hash)
  WHERE batch_id IS NOT NULL;
CREATE INDEX idx_review_proposals_queue
  ON review_proposals(status, created_at DESC, id DESC);
CREATE INDEX idx_review_proposals_batch
  ON review_proposals(batch_id, status, created_at DESC);
CREATE INDEX idx_review_proposals_claim
  ON review_proposals(claimed_by, claimed_until);
CREATE INDEX idx_rules_created_by_created_at
  ON rules(created_by, created_at DESC);
CREATE UNIQUE INDEX idx_users_nickname_normalized
  ON users(nickname_normalized)
  WHERE nickname_normalized IS NOT NULL;
CREATE INDEX idx_game_catalog_entries_version
  ON game_catalog_entries(catalog_version, game_id);
CREATE INDEX idx_user_game_favorites_user_created
  ON user_game_favorites(user_id, created_at DESC);
CREATE INDEX idx_rules_public_updated
  ON rules(status, updated_at DESC, game_id);
CREATE INDEX idx_game_public_rule_heads_recent
  ON game_public_rule_heads(updated_at DESC, rule_id DESC);
CREATE INDEX idx_rules_game_public_updated
  ON rules(game_id, status, updated_at DESC, id DESC);
CREATE INDEX idx_game_view_dedup_created_at
  ON game_view_dedup(created_at);
CREATE INDEX idx_game_daily_view_counts_date
  ON game_daily_view_counts(view_date, last_view_at DESC);
CREATE INDEX idx_rule_importance_votes_user_game
  ON rule_importance_votes(user_id, game_id, rule_id);
CREATE INDEX idx_rule_revisions_edited_by
  ON rule_revisions(edited_by, rule_id);
CREATE INDEX idx_tags_created_by
  ON tags(created_by, id);
CREATE INDEX idx_rule_tags_created_by
  ON rule_tags(created_by, rule_id, tag_id);
CREATE INDEX idx_games_created_by
  ON games(created_by, id);
CREATE INDEX idx_games_rename_owner
  ON games(rename_owner_id, id);
CREATE INDEX idx_submissions_author
  ON submissions(author_id, id);
CREATE INDEX idx_rules_submission_id
  ON rules(submission_id, id);
CREATE INDEX idx_rules_hidden_by
  ON rules(hidden_by, id);
CREATE INDEX idx_sessions_user_id
  ON sessions(user_id, id_hash);
CREATE INDEX idx_user_roles_granted_by
  ON user_roles(granted_by, user_id);
CREATE INDEX idx_editor_invitations_invited_by
  ON editor_invitations(invited_by, id);
CREATE INDEX idx_editor_invitations_claimed_by
  ON editor_invitations(claimed_by, id);
CREATE INDEX idx_review_batches_created_by
  ON review_batches(created_by, id);
CREATE INDEX idx_review_proposals_created_by
  ON review_proposals(created_by, id);
CREATE INDEX idx_review_proposals_reviewed_by
  ON review_proposals(reviewed_by, id);
CREATE INDEX idx_user_roles_active_role
  ON user_roles(role, user_id)
  WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_users_email_hash ON users(email_hash) WHERE email_hash IS NOT NULL;
CREATE UNIQUE INDEX idx_editor_invitations_active_email_hash
  ON editor_invitations(email_hash)
  WHERE email_hash IS NOT NULL AND claimed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_rules_creator_pending_review
  ON rules(created_by, review_status, status, id);
CREATE INDEX idx_rules_game_pending_review
  ON rules(game_id, review_status, status, id);
CREATE INDEX idx_rules_reviewed_by
  ON rules(reviewed_by, id);
CREATE INDEX idx_games_creator_pending_review
  ON games(created_by, review_status, visibility, merged_into_game_id, id);
CREATE INDEX idx_games_reviewed_by
  ON games(reviewed_by, id);
CREATE INDEX idx_submissions_game ON submissions(game_id);
CREATE INDEX idx_rules_pending_review_by
  ON rules(pending_review_by, review_status, status, id);
CREATE INDEX idx_game_external_resources_game
  ON game_external_resources(game_id, category, name, id);
CREATE INDEX idx_attribute_subjects_game ON attribute_subjects(game_id);
CREATE INDEX idx_attribute_subjects_kind_name ON attribute_subjects(kind, display_name, id);
CREATE INDEX idx_attribute_subject_components_game ON attribute_subject_components(game_id);
CREATE INDEX idx_attribute_ratings_subject_attribute ON attribute_ratings(subject_id, attribute_id, updated_at DESC);
CREATE INDEX idx_attribute_ratings_attribute_subject ON attribute_ratings(attribute_id, subject_id, updated_at DESC);
CREATE INDEX idx_attribute_comparisons_pair ON attribute_comparisons(subject_a_id, subject_b_id, attribute_id, updated_at DESC);
CREATE INDEX idx_attribute_import_candidates_status ON attribute_import_candidates(match_status, source_name, source_row_number);
CREATE INDEX idx_attribute_vote_events_session ON attribute_vote_events(session_id, created_at DESC);
CREATE INDEX idx_attribute_vote_events_subject_attribute ON attribute_vote_events(subject_a_id, attribute_id, created_at DESC);
CREATE INDEX idx_attribute_vote_events_pair ON attribute_vote_events(subject_a_id, subject_b_id, attribute_id, created_at DESC);
CREATE INDEX idx_attribute_vote_events_recent ON attribute_vote_events(created_at DESC, id DESC);
CREATE INDEX idx_attribute_pair_stats_attribute ON attribute_pair_stats(attribute_id, comparison_count, subject_a_id, subject_b_id);
CREATE INDEX idx_attribute_score_states_random
  ON attribute_score_states(attribute_id, random_key, subject_id);
CREATE INDEX idx_attribute_activity_feed_recent
  ON attribute_activity_feed(created_at DESC, id DESC);
CREATE INDEX idx_attribute_score_states_question_slot
  ON attribute_score_states(attribute_id, question_slot, rating_deviation DESC, random_key, subject_id);
CREATE INDEX idx_attributes_active_random
  ON attributes(is_active, random_key, id);
CREATE INDEX idx_attribute_score_states_question_slot_global
  ON attribute_score_states(question_slot, rating_deviation DESC, random_key, attribute_id, subject_id);
CREATE INDEX idx_attribute_catalog_entries_version
  ON attribute_catalog_entries(catalog_version, entry_key);
CREATE INDEX idx_attribute_catalog_snapshot_chunks_generation
  ON attribute_catalog_snapshot_chunks(generation, chunk_number);
CREATE INDEX idx_attribute_vote_responses_recent
  ON attribute_vote_responses(created_at DESC, response_id DESC);
CREATE INDEX idx_attribute_score_states_attribute_score
  ON attribute_score_states(attribute_id, score, subject_id);
CREATE INDEX idx_attribute_merge_rebuild_jobs_queue
  ON attribute_merge_rebuild_jobs(status, created_at, id);
CREATE UNIQUE INDEX idx_attribute_merge_rebuild_jobs_one_active
  ON attribute_merge_rebuild_jobs(status)
  WHERE status IN ('pending', 'running');
CREATE UNIQUE INDEX idx_attribute_subject_component_aliases_unique
  ON attribute_subject_component_aliases(subject_id, component_order, normalized_alias);
CREATE INDEX idx_attribute_subject_component_aliases_search
  ON attribute_subject_component_aliases(normalized_alias, subject_id, component_order);
CREATE UNIQUE INDEX idx_games_bgg_id
  ON games(bgg_id)
  WHERE bgg_id IS NOT NULL;
CREATE INDEX idx_game_external_ids_game_source
  ON game_external_ids(game_id, source, external_id);
CREATE INDEX idx_rule_game_variants_game_rule
  ON rule_game_variants(game_id, rule_id);
CREATE INDEX idx_rule_game_variants_rule_game
  ON rule_game_variants(rule_id, game_id);
CREATE INDEX idx_game_entity_relations_target_type_source
  ON game_entity_relations(target_game_id, relation_type, source_game_id);
CREATE INDEX idx_game_entity_relations_source_type_target
  ON game_entity_relations(source_game_id, relation_type, target_game_id);
CREATE INDEX idx_attribute_subject_components_subject_type_bgg_order
  ON attribute_subject_components(subject_id, component_type, bgg_id, component_order);
CREATE INDEX idx_attribute_subject_components_subject_type_order
  ON attribute_subject_components(subject_id, component_type, component_order);
CREATE TRIGGER rules_stats_after_insert
AFTER INSERT ON rules
BEGIN
  UPDATE games
  SET published_rule_count = published_rule_count + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END,
      total_rule_count = total_rule_count + 1,
      latest_rule_updated_at = CASE
        WHEN latest_rule_updated_at IS NULL OR NEW.updated_at > latest_rule_updated_at THEN NEW.updated_at
        ELSE latest_rule_updated_at
      END
  WHERE id = NEW.game_id;
END;
CREATE TRIGGER rules_stats_after_delete
AFTER DELETE ON rules
BEGIN
  UPDATE games
  SET published_rule_count = MAX(0, published_rule_count - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END),
      total_rule_count = MAX(0, total_rule_count - 1),
      latest_rule_updated_at = (
        SELECT MAX(r.updated_at) FROM rules r WHERE r.game_id = OLD.game_id
      )
  WHERE id = OLD.game_id;
END;
CREATE TRIGGER rules_stats_after_update_same_game
AFTER UPDATE OF status, updated_at ON rules
WHEN OLD.game_id = NEW.game_id
BEGIN
  UPDATE games
  SET published_rule_count = MAX(0, published_rule_count
        - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END
        + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END),
      latest_rule_updated_at = CASE
        WHEN latest_rule_updated_at IS NULL OR NEW.updated_at > latest_rule_updated_at THEN NEW.updated_at
        ELSE latest_rule_updated_at
      END
  WHERE id = NEW.game_id;
END;
CREATE TRIGGER rules_stats_after_move_old_game
AFTER UPDATE OF game_id ON rules
WHEN OLD.game_id <> NEW.game_id
BEGIN
  UPDATE games
  SET published_rule_count = MAX(0, published_rule_count - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END),
      total_rule_count = MAX(0, total_rule_count - 1),
      latest_rule_updated_at = (
        SELECT MAX(r.updated_at) FROM rules r WHERE r.game_id = OLD.game_id
      )
  WHERE id = OLD.game_id;
END;
CREATE TRIGGER rules_stats_after_move_new_game
AFTER UPDATE OF game_id ON rules
WHEN OLD.game_id <> NEW.game_id
BEGIN
  UPDATE games
  SET published_rule_count = published_rule_count + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END,
      total_rule_count = total_rule_count + 1,
      latest_rule_updated_at = CASE
        WHEN latest_rule_updated_at IS NULL OR NEW.updated_at > latest_rule_updated_at THEN NEW.updated_at
        ELSE latest_rule_updated_at
      END
  WHERE id = NEW.game_id;
END;
CREATE TRIGGER rules_rename_guard_after_insert
AFTER INSERT ON rules
BEGIN
  UPDATE games
  SET rename_locked = CASE
        WHEN rename_locked = 1 OR NEW.created_by IS NULL OR rename_owner_id IS NULL OR rename_owner_id <> NEW.created_by THEN 1
        ELSE 0
      END,
      rename_owner_id = CASE
        WHEN rename_locked = 1 OR NEW.created_by IS NULL OR rename_owner_id IS NULL OR rename_owner_id <> NEW.created_by THEN NULL
        ELSE rename_owner_id
      END
  WHERE id = NEW.game_id;
END;
CREATE TRIGGER rules_rename_guard_after_move
AFTER UPDATE OF game_id ON rules
WHEN OLD.game_id <> NEW.game_id
BEGIN
  UPDATE games
  SET rename_locked = CASE
        WHEN rename_locked = 1 OR NEW.created_by IS NULL OR rename_owner_id IS NULL OR rename_owner_id <> NEW.created_by THEN 1
        ELSE 0
      END,
      rename_owner_id = CASE
        WHEN rename_locked = 1 OR NEW.created_by IS NULL OR rename_owner_id IS NULL OR rename_owner_id <> NEW.created_by THEN NULL
        ELSE rename_owner_id
      END
  WHERE id = NEW.game_id;
END;
CREATE TRIGGER rule_revisions_public_editors_after_insert
AFTER INSERT ON rule_revisions
BEGIN
  UPDATE rules
  SET editor_ids_json = CASE
    WHEN EXISTS (
      SELECT 1 FROM json_each(COALESCE(editor_ids_json, '[]'))
      WHERE value = NEW.edited_by
    ) THEN COALESCE(editor_ids_json, '[]')
    ELSE json_insert(COALESCE(editor_ids_json, '[]'), '$[#]', NEW.edited_by)
  END
  WHERE id = NEW.rule_id;
END;
CREATE TRIGGER trg_public_tag_catalog_delete
AFTER DELETE ON tags
WHEN OLD.status = 'active' AND OLD.is_public = 1
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (OLD.id, (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1), NULL, 1, OLD.updated_at)
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER trg_public_tag_catalog_insert
AFTER INSERT ON tags
WHEN NEW.status = 'active' AND NEW.is_public = 1
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    NEW.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    json_object(
      'id', NEW.id,
      'slug', NEW.slug,
      'name', NEW.name,
      'isPublic', json('true'),
      'updatedAt', NEW.updated_at,
      'aliases', json('[]'),
      'categoryHints', json(COALESCE(NEW.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(NEW.detection_keywords_json, '[]'))
    ),
    0,
    NEW.updated_at
  )
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = 0,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER trg_public_tag_catalog_update
AFTER UPDATE OF slug, name, status, is_public, updated_at, category_hints_json, detection_keywords_json ON tags
WHEN (OLD.status = 'active' AND OLD.is_public = 1)
  OR (NEW.status = 'active' AND NEW.is_public = 1)
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    NEW.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    CASE WHEN NEW.status = 'active' AND NEW.is_public = 1 THEN json_object(
      'id', NEW.id,
      'slug', NEW.slug,
      'name', NEW.name,
      'isPublic', json('true'),
      'updatedAt', NEW.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = NEW.id ORDER BY alias)
      ), '[]')),
      'categoryHints', json(COALESCE(NEW.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(NEW.detection_keywords_json, '[]'))
    ) ELSE NULL END,
    CASE WHEN NEW.status = 'active' AND NEW.is_public = 1 THEN 0 ELSE 1 END,
    NEW.updated_at
  )
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER trg_public_tag_catalog_alias_insert
AFTER INSERT ON tag_aliases
WHEN EXISTS (SELECT 1 FROM tags WHERE id = NEW.tag_id AND status = 'active' AND is_public = 1)
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  SELECT
    t.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    json_object(
      'id', t.id,
      'slug', t.slug,
      'name', t.name,
      'isPublic', json('true'),
      'updatedAt', t.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = t.id ORDER BY alias)
      ), '[]')),
      'categoryHints', json(COALESCE(t.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(t.detection_keywords_json, '[]'))
    ),
    0,
    t.updated_at
  FROM tags t WHERE t.id = NEW.tag_id
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = 0,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER trg_public_tag_catalog_alias_delete
AFTER DELETE ON tag_aliases
WHEN EXISTS (SELECT 1 FROM tags WHERE id = OLD.tag_id AND status = 'active' AND is_public = 1)
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  SELECT
    t.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    json_object(
      'id', t.id,
      'slug', t.slug,
      'name', t.name,
      'isPublic', json('true'),
      'updatedAt', t.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = t.id ORDER BY alias)
      ), '[]')),
      'categoryHints', json(COALESCE(t.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(t.detection_keywords_json, '[]'))
    ),
    0,
    t.updated_at
  FROM tags t WHERE t.id = OLD.tag_id
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = 0,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER trg_public_tag_catalog_alias_update
AFTER UPDATE OF alias, normalized_alias ON tag_aliases
WHEN EXISTS (SELECT 1 FROM tags WHERE id = NEW.tag_id AND status = 'active' AND is_public = 1)
BEGIN
  UPDATE public_tag_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO public_tag_catalog_entries (tag_id, catalog_version, entry_json, deleted, updated_at)
  SELECT
    t.id,
    (SELECT current_version FROM public_tag_catalog_clock WHERE id = 1),
    json_object(
      'id', t.id,
      'slug', t.slug,
      'name', t.name,
      'isPublic', json('true'),
      'updatedAt', t.updated_at,
      'aliases', json(COALESCE((
        SELECT json_group_array(alias)
        FROM (SELECT alias FROM tag_aliases WHERE tag_id = t.id ORDER BY alias)
      ), '[]')),
      'categoryHints', json(COALESCE(t.category_hints_json, '[]')),
      'detectionKeywords', json(COALESCE(t.detection_keywords_json, '[]'))
    ),
    0,
    t.updated_at
  FROM tags t WHERE t.id = NEW.tag_id
  ON CONFLICT(tag_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = 0,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER user_game_favorites_limit
BEFORE INSERT ON user_game_favorites
WHEN (
  SELECT COUNT(*) FROM user_game_favorites WHERE user_id = NEW.user_id
) >= 6
BEGIN
  SELECT RAISE(ABORT, 'favorite_limit_reached');
END;
CREATE TRIGGER game_public_rule_heads_insert
AFTER INSERT ON rules
WHEN NEW.status = 'published'
BEGIN
  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  VALUES (NEW.game_id, NEW.id, NEW.updated_at)
  ON CONFLICT(game_id) DO UPDATE SET
    rule_id = excluded.rule_id,
    updated_at = excluded.updated_at
  WHERE excluded.updated_at > game_public_rule_heads.updated_at
    OR (
      excluded.updated_at = game_public_rule_heads.updated_at
      AND excluded.rule_id > game_public_rule_heads.rule_id
    );
END;
CREATE TRIGGER game_public_rule_heads_update_same_game
AFTER UPDATE OF game_id, status, updated_at ON rules
WHEN OLD.game_id = NEW.game_id
BEGIN
  DELETE FROM game_public_rule_heads WHERE game_id = NEW.game_id;
  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  SELECT game_id, id, updated_at
  FROM rules
  WHERE game_id = NEW.game_id AND status = 'published'
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;
END;
CREATE TRIGGER game_public_rule_heads_update_moved_game
AFTER UPDATE OF game_id, status, updated_at ON rules
WHEN OLD.game_id <> NEW.game_id
BEGIN
  DELETE FROM game_public_rule_heads
  WHERE game_id = OLD.game_id OR game_id = NEW.game_id;

  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  SELECT game_id, id, updated_at
  FROM rules
  WHERE game_id = OLD.game_id AND status = 'published'
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;

  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  SELECT game_id, id, updated_at
  FROM rules
  WHERE game_id = NEW.game_id AND status = 'published'
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;
END;
CREATE TRIGGER game_public_rule_heads_delete
AFTER DELETE ON rules
WHEN OLD.status = 'published'
BEGIN
  DELETE FROM game_public_rule_heads WHERE game_id = OLD.game_id;
  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  SELECT game_id, id, updated_at
  FROM rules
  WHERE game_id = OLD.game_id AND status = 'published'
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;
END;
CREATE TRIGGER game_view_dedup_after_insert
AFTER INSERT ON game_view_dedup
BEGIN
  INSERT INTO game_daily_view_counts (game_id, view_date, view_count, last_view_at)
  VALUES (NEW.game_id, NEW.view_date, 1, NEW.created_at)
  ON CONFLICT(game_id, view_date) DO UPDATE SET
    view_count = game_daily_view_counts.view_count + 1,
    last_view_at = MAX(game_daily_view_counts.last_view_at, excluded.last_view_at);
END;
CREATE TRIGGER trg_rule_importance_vote_insert
AFTER INSERT ON rule_importance_votes
BEGIN
  UPDATE rules
  SET importance_count = importance_count + 1
  WHERE id = NEW.rule_id;
END;
CREATE TRIGGER trg_rule_importance_vote_delete
AFTER DELETE ON rule_importance_votes
BEGIN
  UPDATE rules
  SET importance_count = MAX(0, importance_count - 1)
  WHERE id = OLD.rule_id;
END;
CREATE TRIGGER users_prevent_last_admin_delete
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
CREATE TRIGGER games_pending_quota_before_insert
BEFORE INSERT ON games
WHEN NEW.review_status = 'pending' AND NEW.visibility = 'public' AND NEW.merged_into_game_id IS NULL
  AND (SELECT COUNT(*) FROM games
       WHERE created_by = NEW.created_by
         AND review_status = 'pending' AND visibility = 'public'
         AND merged_into_game_id IS NULL) >= 1
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
         AND merged_into_game_id IS NULL) >= 1
BEGIN
  SELECT RAISE(ABORT, 'pending_game_limit');
END;
CREATE TRIGGER rules_review_status_before_insert
BEFORE INSERT ON rules
WHEN NEW.review_status <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = NEW.created_by AND role IN ('editor', 'admin') AND revoked_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'untrusted_rule_must_be_pending');
END;
CREATE TRIGGER games_review_status_before_insert
BEFORE INSERT ON games
WHEN NEW.review_status <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = NEW.created_by AND role IN ('editor', 'admin') AND revoked_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'untrusted_game_must_be_pending');
END;
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
CREATE TRIGGER attribute_subject_games_after_update AFTER UPDATE OF display_name, merged_into_game_id ON games
BEGIN
  UPDATE attribute_subjects SET display_name = NEW.display_name, updated_at = NEW.updated_at WHERE game_id = NEW.id AND kind = 'game';
  UPDATE attribute_subject_components SET label = NEW.display_name WHERE game_id = NEW.id AND component_type = 'base';
END;
CREATE TRIGGER attribute_score_states_rd_insert_guard
BEFORE INSERT ON attribute_score_states
WHEN NEW.rating_deviation < 0.25 OR NEW.rating_deviation > 3
BEGIN
  SELECT RAISE(ABORT, 'attribute_rating_deviation_out_of_range');
END;
CREATE TRIGGER attribute_score_states_rd_update_guard
BEFORE UPDATE OF rating_deviation ON attribute_score_states
WHEN NEW.rating_deviation < 0.25 OR NEW.rating_deviation > 3
BEGIN
  SELECT RAISE(ABORT, 'attribute_rating_deviation_out_of_range');
END;
CREATE TRIGGER attributes_random_key_after_insert AFTER INSERT ON attributes
WHEN NEW.random_key = ''
BEGIN
  UPDATE attributes SET random_key = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
CREATE TRIGGER attribute_score_states_catalog_after_delete
AFTER DELETE ON attribute_score_states
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'value:' || OLD.subject_id || ':' || OLD.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_candidates_catalog_after_delete
AFTER DELETE ON attribute_import_candidates
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'candidate:' || OLD.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_subjects_catalog_after_delete
AFTER DELETE ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'subject:' || OLD.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_candidates_catalog_after_insert
AFTER INSERT ON attribute_import_candidates
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'candidate:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.match_status IN ('pending', 'ambiguous') THEN json_object(
      'kind', 'candidate',
      'id', NEW.id,
      'displayName', NEW.source_name,
      'valuesJson', NEW.values_json,
      'matchStatus', NEW.match_status,
      'subjectId', NEW.subject_id,
      'sourceRowNumber', NEW.source_row_number
    ) ELSE NULL END,
    CASE WHEN NEW.match_status IN ('pending', 'ambiguous') THEN 0 ELSE 1 END,
    NEW.updated_at
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_candidates_catalog_after_update
AFTER UPDATE OF source_name, values_json, match_status, subject_id, source_row_number, updated_at
  ON attribute_import_candidates
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'candidate:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.match_status IN ('pending', 'ambiguous') THEN json_object(
      'kind', 'candidate',
      'id', NEW.id,
      'displayName', NEW.source_name,
      'valuesJson', NEW.values_json,
      'matchStatus', NEW.match_status,
      'subjectId', NEW.subject_id,
      'sourceRowNumber', NEW.source_row_number
    ) ELSE NULL END,
    CASE WHEN NEW.match_status IN ('pending', 'ambiguous') THEN 0 ELSE 1 END,
    NEW.updated_at
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_games_catalog_after_delete
AFTER DELETE ON games
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'subject:attribute_subject_game:' || OLD.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attributes_catalog_after_delete
AFTER DELETE ON attributes
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'attribute:' || OLD.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_translations_catalog_after_delete
AFTER DELETE ON attribute_translations
WHEN OLD.locale = 'zh-TW'
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'attribute:' || OLD.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_subject_components_catalog_after_insert
AFTER INSERT ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;
CREATE TRIGGER attribute_subject_components_catalog_after_update
AFTER UPDATE OF component_order, game_id, component_type, label, english_name, bgg_id ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;
CREATE TRIGGER attribute_subject_components_catalog_after_delete
AFTER DELETE ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = OLD.subject_id;
END;
CREATE TRIGGER attribute_subject_component_aliases_after_insert
AFTER INSERT ON attribute_subject_component_aliases
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;
CREATE TRIGGER attribute_subject_component_aliases_after_update
AFTER UPDATE OF alias, normalized_alias ON attribute_subject_component_aliases
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;
CREATE TRIGGER attribute_subject_component_aliases_after_delete
AFTER DELETE ON attribute_subject_component_aliases
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = OLD.subject_id;
END;
CREATE TRIGGER game_catalog_games_after_insert
AFTER INSERT ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_catalog_games_after_update
AFTER UPDATE OF slug, display_name, english_name, merged_into_game_id, visibility,
  published_rule_count, total_rule_count, latest_rule_updated_at, entity_kind ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_catalog_games_after_delete
AFTER DELETE ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    OLD.id,
    (SELECT current_version FROM game_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_catalog_aliases_after_insert
AFTER INSERT ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_catalog_aliases_after_delete
AFTER DELETE ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = OLD.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_catalog_aliases_after_update
AFTER UPDATE OF game_id, alias ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;

  UPDATE game_catalog_clock SET current_version = current_version + 1
  WHERE id = 1 AND OLD.game_id <> NEW.game_id;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = OLD.game_id AND OLD.game_id <> NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_catalog_relations_after_insert
AFTER INSERT ON game_entity_relations
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.source_game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_catalog_relations_after_update
AFTER UPDATE OF source_game_id, target_game_id, relation_type ON game_entity_relations
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.source_game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_catalog_relations_after_delete
AFTER DELETE ON game_entity_relations
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = OLD.source_game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_subject_games_after_insert AFTER INSERT ON games
WHEN NEW.merged_into_game_id IS NULL AND NEW.entity_kind IN ('base', 'expansion')
BEGIN
  INSERT OR IGNORE INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game', NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT 'attribute_subject_game:' || NEW.id, id, 5, 0, 0, 0, 0, 0,
    'glicko-rd-v1', NEW.updated_at, 3, lower(hex(randomblob(16))),
    (abs(random()) % 200) + 1
  FROM attributes
  WHERE is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = 'attribute_subject_game:' || NEW.id
    );
END;
CREATE TRIGGER attribute_subject_games_after_classification
AFTER UPDATE OF entity_kind, bgg_id, merged_into_game_id, visibility,
  published_rule_count, attribute_enabled ON games
WHEN NEW.merged_into_game_id IS NULL
  AND NEW.entity_kind IN ('base', 'expansion')
BEGIN
  INSERT OR IGNORE INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game', NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1', NEW.updated_at,
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE subject.game_id = NEW.id
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;
CREATE TRIGGER attribute_subject_games_after_declassification
AFTER UPDATE OF entity_kind ON games
WHEN NEW.entity_kind IN ('version', 'unknown')
  AND OLD.entity_kind IN ('base', 'expansion')
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = 'attribute_subject_game:' || NEW.id;
  DELETE FROM attribute_subjects
  WHERE id = 'attribute_subject_game:' || NEW.id
    AND NOT EXISTS (SELECT 1 FROM attribute_ratings r WHERE r.subject_id = attribute_subjects.id)
    AND NOT EXISTS (
      SELECT 1 FROM attribute_comparisons c
      WHERE c.subject_a_id = attribute_subjects.id OR c.subject_b_id = attribute_subjects.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM attribute_vote_events e
      WHERE e.subject_a_id = attribute_subjects.id OR e.subject_b_id = attribute_subjects.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM attribute_vote_responses response
      WHERE response.subject_a_id = attribute_subjects.id OR response.subject_b_id = attribute_subjects.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM attribute_pair_stats pair_stats
      WHERE pair_stats.subject_a_id = attribute_subjects.id OR pair_stats.subject_b_id = attribute_subjects.id
    );
END;
CREATE TRIGGER attribute_game_external_ids_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    NEW.created_at, 3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE (subject.game_id = NEW.game_id OR EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = subject.id AND component.game_id = NEW.game_id
    ))
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;
CREATE TRIGGER attribute_subject_components_bgg_after_insert
AFTER INSERT ON attribute_subject_components
WHEN NEW.bgg_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE subject.id = NEW.subject_id
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;
CREATE TRIGGER attribute_subject_components_bgg_after_update
AFTER UPDATE OF bgg_id ON attribute_subject_components
WHEN NEW.bgg_id IS NOT NULL
  AND (OLD.bgg_id IS NULL OR OLD.bgg_id <> NEW.bgg_id)
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE subject.id = NEW.subject_id
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;
CREATE TRIGGER attribute_games_after_bgg_loss
AFTER UPDATE OF bgg_id ON games
WHEN OLD.bgg_id IS NOT NULL
  AND NEW.bgg_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM game_external_ids external_id
    WHERE external_id.game_id = NEW.id AND external_id.source = 'bgg'
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_subject_components component
    JOIN attribute_subjects subject ON subject.id = component.subject_id
    WHERE subject.game_id = NEW.id
      AND component.component_type = 'base'
      AND component.bgg_id IS NOT NULL
  )
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = 'attribute_subject_game:' || NEW.id
    AND evidence_count = 0;
END;
CREATE TRIGGER attribute_game_external_ids_after_delete
AFTER DELETE ON game_external_ids
WHEN OLD.source = 'bgg'
  AND NOT EXISTS (
    SELECT 1 FROM games game
    WHERE game.id = OLD.game_id AND game.bgg_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM game_external_ids external_id
    WHERE external_id.game_id = OLD.game_id AND external_id.source = 'bgg'
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_subject_components component
    JOIN attribute_subjects subject ON subject.id = component.subject_id
    WHERE subject.game_id = OLD.game_id
      AND component.component_type = 'base'
      AND component.bgg_id IS NOT NULL
  )
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = 'attribute_subject_game:' || OLD.game_id
    AND evidence_count = 0;
END;
CREATE TRIGGER attribute_subject_components_bgg_after_loss
AFTER UPDATE OF bgg_id ON attribute_subject_components
WHEN OLD.bgg_id IS NOT NULL
  AND NEW.bgg_id IS NULL
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = NEW.subject_id
    AND evidence_count = 0
    AND NOT EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = NEW.subject_id
    );
END;
CREATE TRIGGER attribute_subject_components_bgg_after_delete
AFTER DELETE ON attribute_subject_components
WHEN OLD.bgg_id IS NOT NULL
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = OLD.subject_id
    AND evidence_count = 0
    AND NOT EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = OLD.subject_id
    );
END;
CREATE TRIGGER attributes_score_states_after_insert
AFTER INSERT ON attributes
WHEN NEW.is_active = 1
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, NEW.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  WHERE EXISTS (
    SELECT 1 FROM attribute_votable_subjects eligible
    WHERE eligible.subject_id = subject.id
  );
END;
CREATE TRIGGER attributes_score_states_after_activate
AFTER UPDATE OF is_active ON attributes
WHEN NEW.is_active = 1 AND OLD.is_active = 0
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, NEW.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  WHERE EXISTS (
    SELECT 1 FROM attribute_votable_subjects eligible
    WHERE eligible.subject_id = subject.id
  );
END;
CREATE TRIGGER attribute_subjects_catalog_after_insert
AFTER INSERT ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_subjects_catalog_after_update
AFTER UPDATE OF slug, kind, display_name, game_id, updated_at ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_games_catalog_after_update
AFTER UPDATE OF slug, display_name, english_name, bgg_id, entity_kind,
  merged_into_game_id, visibility, published_rule_count, attribute_enabled ON games
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  JOIN attribute_subjects subject ON subject.id = source.subject_id
  WHERE subject.game_id = NEW.id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_external_ids_catalog_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
  AND EXISTS (
    SELECT 1 FROM attribute_subjects
    WHERE id = 'attribute_subject_game:' || NEW.game_id
  )
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = 'attribute_subject_game:' || NEW.game_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER game_external_ids_catalog_after_delete
AFTER DELETE ON game_external_ids
WHEN OLD.source = 'bgg'
  AND EXISTS (
    SELECT 1 FROM attribute_subjects
    WHERE id = 'attribute_subject_game:' || OLD.game_id
  )
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = 'attribute_subject_game:' || OLD.game_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_game_aliases_after_insert
AFTER INSERT ON game_aliases
WHEN EXISTS (
  SELECT 1 FROM attribute_subjects subject
  WHERE subject.game_id = NEW.game_id AND subject.kind = 'game'
)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  JOIN attribute_subjects subject ON subject.id = source.subject_id
  WHERE subject.game_id = NEW.game_id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_game_aliases_after_delete
AFTER DELETE ON game_aliases
WHEN EXISTS (
  SELECT 1 FROM attribute_subjects subject
  WHERE subject.game_id = OLD.game_id AND subject.kind = 'game'
)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  JOIN attribute_subjects subject ON subject.id = source.subject_id
  WHERE subject.game_id = OLD.game_id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_game_aliases_after_update
AFTER UPDATE OF game_id, alias, normalized_alias ON game_aliases
WHEN EXISTS (
  SELECT 1 FROM attribute_subjects subject
  WHERE subject.game_id = NEW.game_id AND subject.kind = 'game'
)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  JOIN attribute_subjects subject ON subject.id = source.subject_id
  WHERE subject.game_id = NEW.game_id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attributes_catalog_after_insert
AFTER INSERT ON attributes
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'attribute:' || a.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN json_object(
      'kind', 'attribute',
      'attribute', json_object(
        'id', a.id,
        'key', a.key,
        'scaleType', a.scale_type,
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
        'endpoints', json(t.endpoints_json),
        'minExample', t.min_example,
        'maxExample', t.max_example,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      )
    ) ELSE NULL END,
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN 0 ELSE 1 END,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attributes a
  LEFT JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
  WHERE a.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attributes_catalog_after_update
AFTER UPDATE OF key, category, min_value, max_value, is_active, sort_order, scale_type ON attributes
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'attribute:' || a.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN json_object(
      'kind', 'attribute',
      'attribute', json_object(
        'id', a.id,
        'key', a.key,
        'scaleType', a.scale_type,
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
        'endpoints', json(t.endpoints_json),
        'minExample', t.min_example,
        'maxExample', t.max_example,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      )
    ) ELSE NULL END,
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN 0 ELSE 1 END,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attributes a
  LEFT JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
  WHERE a.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_translations_catalog_after_insert
AFTER INSERT ON attribute_translations
WHEN NEW.locale = 'zh-TW'
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'attribute:' || a.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN a.is_active = 1 THEN json_object(
      'kind', 'attribute',
      'attribute', json_object(
        'id', a.id,
        'key', a.key,
        'scaleType', a.scale_type,
        'name', NEW.name,
        'shortDescription', NEW.short_description,
        'fullDescription', NEW.full_description,
        'endpoints', json(NEW.endpoints_json),
        'minExample', NEW.min_example,
        'maxExample', NEW.max_example,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      )
    ) ELSE NULL END,
    CASE WHEN a.is_active = 1 THEN 0 ELSE 1 END,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attributes a
  WHERE a.id = NEW.attribute_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_translations_catalog_after_update
AFTER UPDATE OF attribute_id, locale, name, short_description, full_description, min_example, max_example, endpoints_json ON attribute_translations
WHEN OLD.locale = 'zh-TW' OR NEW.locale = 'zh-TW'
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'attribute:' || a.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN json_object(
      'kind', 'attribute',
      'attribute', json_object(
        'id', a.id,
        'key', a.key,
        'scaleType', a.scale_type,
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
        'endpoints', json(t.endpoints_json),
        'minExample', t.min_example,
        'maxExample', t.max_example,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      )
    ) ELSE NULL END,
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN 0 ELSE 1 END,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attributes a
  LEFT JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
  WHERE a.id = CASE WHEN NEW.locale = 'zh-TW' THEN NEW.attribute_id ELSE OLD.attribute_id END
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_score_states_catalog_after_insert
AFTER INSERT ON attribute_score_states
WHEN NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'value:' || NEW.subject_id || ':' || NEW.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_patch(
      json_object(
        'kind', 'value',
        'subjectId', NEW.subject_id,
        'attributeId', NEW.attribute_id,
        'score', NEW.score,
        'ratingDeviation', NEW.rating_deviation,
        'directAverage', CASE WHEN NEW.direct_count > 0 THEN NEW.direct_sum / NEW.direct_count ELSE NULL END,
        'directCount', NEW.direct_count,
        'comparisonCount', NEW.comparison_count,
        'decisiveComparisonCount', NEW.decisive_comparison_count,
        'evidenceCount', NEW.evidence_count,
        'modelVersion', NEW.model_version,
        'subject', json_object(
          'id', s.id,
          'slug', s.slug,
          'kind', s.kind,
          'displayName', s.display_name,
          'gameId', s.game_id,
          'gameSlug', g.slug
        )
      ),
      '{}'
    ),
    0,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = NEW.subject_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE TRIGGER attribute_score_states_catalog_after_update
AFTER UPDATE OF score, rating_deviation, direct_sum, direct_count,
  comparison_count, decisive_comparison_count, evidence_count, model_version
  ON attribute_score_states
WHEN NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'value:' || NEW.subject_id || ':' || NEW.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_patch(
      json_object(
        'kind', 'value',
        'subjectId', NEW.subject_id,
        'attributeId', NEW.attribute_id,
        'score', NEW.score,
        'ratingDeviation', NEW.rating_deviation,
        'directAverage', CASE WHEN NEW.direct_count > 0 THEN NEW.direct_sum / NEW.direct_count ELSE NULL END,
        'directCount', NEW.direct_count,
        'comparisonCount', NEW.comparison_count,
        'decisiveComparisonCount', NEW.decisive_comparison_count,
        'evidenceCount', NEW.evidence_count,
        'modelVersion', NEW.model_version,
        'subject', json_object(
          'id', s.id,
          'slug', s.slug,
          'kind', s.kind,
          'displayName', s.display_name,
          'gameId', s.game_id,
          'gameSlug', g.slug
        )
      ),
      '{}'
    ),
    0,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = NEW.subject_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
CREATE VIEW attribute_subject_display_names AS
SELECT
  s.id,
  CASE WHEN s.kind = 'configuration' THEN
    COALESCE(base_component.game_name, base_component.label, s.display_name)
      || CASE WHEN expansion_components.expansion_name IS NOT NULL
        THEN '＋' || expansion_components.expansion_name ELSE '' END
  ELSE s.display_name END AS display_name
FROM attribute_subjects s
LEFT JOIN (
  SELECT c.subject_id, c.label, g.display_name AS game_name
  FROM attribute_subject_components c
  LEFT JOIN games g ON g.id = c.game_id
  WHERE c.component_type = 'base'
) base_component ON base_component.subject_id = s.id
LEFT JOIN (
  SELECT subject_id, group_concat(label, '＋') AS expansion_name
  FROM (
    SELECT subject_id, label
    FROM attribute_subject_components
    WHERE component_type = 'expansion'
    ORDER BY subject_id, component_order
  ) ordered_expansions
  GROUP BY subject_id
) expansion_components ON expansion_components.subject_id = s.id;
CREATE VIEW attribute_subject_component_catalog_json AS
SELECT c.subject_id, c.component_order,
  json_object(
    'order', c.component_order,
    'gameId', c.game_id,
    'type', c.component_type,
    'label', c.label,
    'englishName', c.english_name,
    'bggId', c.bgg_id
  ) AS component_json
FROM attribute_subject_components c;
CREATE VIEW game_catalog_source AS
SELECT g.id AS game_id,
  CASE WHEN g.merged_into_game_id IS NULL AND g.visibility = 'public' THEN 0 ELSE 1 END AS deleted,
  json_object(
    'id', g.id,
    'slug', g.slug,
    'displayName', g.display_name,
    'englishName', g.english_name,
    'aliases', json(COALESCE((
      SELECT json_group_array(alias)
      FROM (SELECT alias FROM game_aliases a WHERE a.game_id = g.id ORDER BY alias)
    ), '[]')),
    'ruleCount', g.published_rule_count,
    'publishedRuleCount', g.published_rule_count,
    'totalRuleCount', g.total_rule_count,
    'latestRuleUpdatedAt', g.latest_rule_updated_at,
    'updatedAt', g.updated_at,
    'entityKind', g.entity_kind,
    'parentGameId', (
      SELECT relation.target_game_id
      FROM game_entity_relations relation
      WHERE relation.source_game_id = g.id
      ORDER BY relation.relation_type, relation.target_game_id
      LIMIT 1
    ),
    'parentGameName', (
      SELECT parent.display_name
      FROM game_entity_relations relation
      JOIN games parent ON parent.id = relation.target_game_id
      WHERE relation.source_game_id = g.id
      ORDER BY relation.relation_type, relation.target_game_id
      LIMIT 1
    ),
    'parentGameSlug', (
      SELECT parent.slug
      FROM game_entity_relations relation
      JOIN games parent ON parent.id = relation.target_game_id
      WHERE relation.source_game_id = g.id
      ORDER BY relation.relation_type, relation.target_game_id
      LIMIT 1
    )
  ) AS entry_json,
  g.updated_at
FROM games g;
CREATE VIEW attribute_votable_subjects AS
SELECT s.id AS subject_id
FROM attribute_subjects s
LEFT JOIN games g ON g.id = s.game_id
WHERE (
  s.kind = 'game'
  AND g.entity_kind IN ('base', 'expansion')
  AND g.merged_into_game_id IS NULL
  AND g.visibility = 'public'
  AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
  AND (
    g.bgg_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM game_external_ids external_id
      WHERE external_id.game_id = g.id AND external_id.source = 'bgg'
    )
    OR EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = s.id
        AND component.component_type = 'base'
        AND component.bgg_id IS NOT NULL
    )
  )
)
OR (
  s.kind = 'configuration'
  AND EXISTS (
    SELECT 1 FROM attribute_subject_components component
    WHERE component.subject_id = s.id
      AND component.component_type = 'base'
      AND component.bgg_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM attribute_subject_components component
    WHERE component.subject_id = s.id
      AND component.component_type = 'expansion'
      AND component.bgg_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_subject_components component
    WHERE component.subject_id = s.id
      AND component.component_type IN ('base', 'expansion')
      AND component.bgg_id IS NULL
  )
);
CREATE VIEW attribute_subject_catalog_source AS
SELECT s.id AS subject_id,
  EXISTS (
    SELECT 1 FROM attribute_votable_subjects eligible
    WHERE eligible.subject_id = s.id
  ) AS is_eligible,
  json_object(
    'kind', 'subject',
    'subject', json_object(
      'id', s.id,
      'slug', s.slug,
      'kind', s.kind,
      'displayName', s.display_name,
      'secondaryName', secondary_names.secondary_name,
      'gameId', s.game_id,
      'gameSlug', g.slug,
      'bggIds', json(COALESCE((
        SELECT json_group_array(bgg_id)
        FROM (
          SELECT g.bgg_id AS bgg_id
          WHERE s.kind = 'game' AND g.bgg_id IS NOT NULL
          UNION
          SELECT CAST(external_id.external_id AS INTEGER) AS bgg_id
          FROM game_external_ids external_id
          WHERE external_id.game_id = s.game_id AND external_id.source = 'bgg'
          UNION
          SELECT component.bgg_id
          FROM attribute_subject_components component
          WHERE component.subject_id = s.id AND component.bgg_id IS NOT NULL
        )
      ), '[]')),
      'components', json(COALESCE((
        SELECT json_group_array(json(component_json))
        FROM (
          SELECT component_json
          FROM attribute_subject_component_catalog_json
          WHERE subject_id = s.id
          ORDER BY component_order
        )
      ), '[]'))
    )
  ) AS entry_json,
  s.updated_at
FROM attribute_subjects s
LEFT JOIN games g ON g.id = s.game_id
LEFT JOIN attribute_subject_secondary_names secondary_names ON secondary_names.id = s.id;
CREATE VIEW attribute_subject_secondary_names AS
WITH game_secondary_names AS (
  SELECT g.id,
    CASE
      WHEN g.display_name NOT GLOB '*[一-龥]*' THEN COALESCE(
        (
          SELECT alias
          FROM game_aliases a
          WHERE a.game_id = g.id
            AND a.alias GLOB '*[一-龥]*'
          ORDER BY a.alias, a.id
          LIMIT 1
        ),
        NULLIF(g.english_name, g.display_name)
      )
      ELSE NULLIF(g.english_name, g.display_name)
    END AS secondary_name
  FROM games g
), base_components AS (
  SELECT c.subject_id,
    COALESCE(game_names.secondary_name, NULLIF(c.english_name, '')) AS base_english_name
  FROM attribute_subject_components c
  LEFT JOIN game_secondary_names game_names ON game_names.id = c.game_id
  WHERE c.component_type = 'base'
), ordered_expansions AS (
  SELECT subject_id, component_order, english_name
  FROM attribute_subject_components
  WHERE component_type = 'expansion'
    AND NULLIF(TRIM(english_name), '') IS NOT NULL
), expansion_names AS (
  SELECT subject_id, group_concat(english_name, ' + ') AS expansion_english_name
  FROM (
    SELECT subject_id, component_order, english_name
    FROM ordered_expansions
    ORDER BY subject_id, component_order
  )
  GROUP BY subject_id
)
SELECT s.id,
  CASE WHEN s.kind = 'configuration' THEN
    CASE
      WHEN base_components.base_english_name IS NULL THEN expansion_names.expansion_english_name
      WHEN expansion_names.expansion_english_name IS NULL THEN base_components.base_english_name
      ELSE base_components.base_english_name || ' + ' || expansion_names.expansion_english_name
    END
  ELSE game_names.secondary_name END AS secondary_name
FROM attribute_subjects s
LEFT JOIN game_secondary_names game_names ON game_names.id = s.game_id
LEFT JOIN base_components ON base_components.subject_id = s.id
LEFT JOIN expansion_names ON expansion_names.subject_id = s.id;
