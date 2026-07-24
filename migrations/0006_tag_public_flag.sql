PRAGMA foreign_keys = ON;

ALTER TABLE tags ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;

UPDATE tags SET is_public = 1 WHERE id LIKE 'tag_%';
