-- The request boundary validates the versioned JSON. Adding a CHECK here
-- would scan existing vote history when applying this additive migration.
ALTER TABLE attribute_vote_responses ADD COLUMN ranking_json TEXT;

-- Editing an original ranking invalidates its derived score state, as editing
-- an original numeric or pairwise answer already does.
CREATE TRIGGER attribute_ranking_responses_require_replay_after_update
AFTER UPDATE OF ranking_json ON attribute_vote_responses
WHEN OLD.ranking_json IS NOT NEW.ranking_json
BEGIN
  UPDATE attribute_replay_status
  SET required_revision = required_revision + 1, history_revision = history_revision + 1
  WHERE id = 1;
END;

CREATE TRIGGER attribute_ranking_responses_require_replay_after_insert
AFTER INSERT ON attribute_vote_responses
WHEN NEW.ranking_json IS NOT NULL AND NEW.recorded_online IS NOT 1
BEGIN
  UPDATE attribute_replay_status
  SET required_revision = required_revision + 1
  WHERE id = 1;
END;

CREATE TRIGGER attribute_ranking_responses_require_replay_after_delete
AFTER DELETE ON attribute_vote_responses
WHEN OLD.ranking_json IS NOT NULL
BEGIN
  UPDATE attribute_replay_status
  SET required_revision = required_revision + 1, history_revision = history_revision + 1
  WHERE id = 1;
END;
