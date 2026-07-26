ALTER TABLE rules ADD COLUMN source_label TEXT;
ALTER TABLE rules ADD COLUMN source_url TEXT;

UPDATE rules
SET source_label = (
      SELECT COALESCE(s.source_label, (
        SELECT ss.label
        FROM submission_sources ss
        WHERE ss.submission_id = s.id
        ORDER BY ss.position, ss.id
        LIMIT 1
      ))
      FROM submissions s
      WHERE s.id = rules.submission_id
    ),
    source_url = (
      SELECT COALESCE(s.source_url, (
        SELECT ss.url
        FROM submission_sources ss
        WHERE ss.submission_id = s.id
        ORDER BY ss.position, ss.id
        LIMIT 1
      ))
      FROM submissions s
      WHERE s.id = rules.submission_id
    )
WHERE source_label IS NULL AND source_url IS NULL;
