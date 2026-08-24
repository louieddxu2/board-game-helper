-- Question selection uses a fixed random slot instead of scanning a large
-- low-confidence candidate pool.  A slot is only a lookup key; the question
-- request chooses slot numbers in memory and then seeks those slots directly.
ALTER TABLE attribute_score_states ADD COLUMN question_slot INTEGER NOT NULL DEFAULT 1;

UPDATE attribute_score_states
SET question_slot = (abs(random()) % 200) + 1
WHERE question_slot = 1;

CREATE INDEX idx_attribute_score_states_question_slot
  ON attribute_score_states(attribute_id, question_slot, rating_deviation DESC, random_key, subject_id);

-- The subject trigger shipped in 0042 must also assign a slot to future games.
DROP TRIGGER attribute_subject_games_after_insert;
CREATE TRIGGER attribute_subject_games_after_insert AFTER INSERT ON games
WHEN NEW.merged_into_game_id IS NULL
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
  FROM attributes WHERE is_active = 1;
END;
