ALTER TABLE users ADD COLUMN show_nickname INTEGER NOT NULL DEFAULT 0;

ALTER TABLE games ADD COLUMN rename_owner_id TEXT REFERENCES users(id);
ALTER TABLE games ADD COLUMN rename_locked INTEGER NOT NULL DEFAULT 0;

UPDATE games
SET rename_owner_id = CASE
      WHEN NOT EXISTS (SELECT 1 FROM rules r WHERE r.game_id = games.id) THEN created_by
      WHEN (SELECT COUNT(DISTINCT r.created_by) FROM rules r WHERE r.game_id = games.id) = 1
        AND NOT EXISTS (SELECT 1 FROM rules r WHERE r.game_id = games.id AND r.created_by IS NULL)
        THEN (SELECT MIN(r.created_by) FROM rules r WHERE r.game_id = games.id)
      ELSE NULL
    END,
    rename_locked = CASE
      WHEN (SELECT COUNT(DISTINCT r.created_by) FROM rules r WHERE r.game_id = games.id) > 1
        OR EXISTS (SELECT 1 FROM rules r WHERE r.game_id = games.id AND r.created_by IS NULL)
        THEN 1
      ELSE 0
    END;

ALTER TABLE rules ADD COLUMN editor_ids_json TEXT NOT NULL DEFAULT '[]';

UPDATE rules
SET editor_ids_json = COALESCE((
  SELECT json_group_array(editor_id)
  FROM (
    SELECT DISTINCT rr.edited_by AS editor_id
    FROM rule_revisions rr
    WHERE rr.rule_id = rules.id
    ORDER BY rr.edited_by
  )
), '[]');

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
