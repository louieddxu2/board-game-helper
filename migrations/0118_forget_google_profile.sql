-- The site no longer keeps Google names or avatars; users are identified only by the nickname they choose.
-- Bounded to the few rows that still hold either value.
UPDATE users SET display_name = NULL, avatar_url = NULL WHERE display_name IS NOT NULL OR avatar_url IS NOT NULL;
