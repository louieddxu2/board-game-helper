DROP INDEX IF EXISTS idx_submissions_game;

ALTER TABLE submissions DROP COLUMN played_on;
ALTER TABLE submissions DROP COLUMN private_note;
ALTER TABLE submissions DROP COLUMN created_at;

CREATE INDEX idx_submissions_game ON submissions(game_id);
