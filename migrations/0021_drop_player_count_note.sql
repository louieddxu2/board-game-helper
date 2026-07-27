-- Convert legacy player_count_note to player_counts_json if player_counts_json is empty
UPDATE rules
SET player_counts_json = '[2]'
WHERE id = 'rule_632fb9bb35d24b65b1c4abf4e00d1a96'
  AND (player_counts_json IS NULL OR player_counts_json = '[]');

-- Drop legacy player_count_note column from rules table
ALTER TABLE rules DROP COLUMN player_count_note;
