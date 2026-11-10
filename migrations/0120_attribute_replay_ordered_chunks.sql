CREATE TABLE attribute_replay_calculation (
  attribute_id TEXT PRIMARY KEY,
  cursor_json TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE attribute_replay_ordered_chunks (
  attribute_id TEXT NOT NULL,
  pass INTEGER NOT NULL,
  run INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (attribute_id, pass, run, chunk_number)
) WITHOUT ROWID;
