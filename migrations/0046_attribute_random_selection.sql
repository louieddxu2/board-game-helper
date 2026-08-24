-- Attribute selection also uses an indexed random key so the request does not
-- count and offset through the active attribute list.
ALTER TABLE attributes ADD COLUMN random_key TEXT NOT NULL DEFAULT '';

UPDATE attributes
SET random_key = lower(hex(randomblob(16)))
WHERE random_key = '';

CREATE INDEX idx_attributes_active_random
  ON attributes(is_active, random_key, id);

CREATE TRIGGER attributes_random_key_after_insert AFTER INSERT ON attributes
WHEN NEW.random_key = ''
BEGIN
  UPDATE attributes SET random_key = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
