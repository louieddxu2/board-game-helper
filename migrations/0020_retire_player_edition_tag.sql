-- The old public tag mixed two attributes that now live directly on each rule.
-- Preserve every affected rule in a manual review batch before removing the tag.
INSERT INTO review_batches (
  id, name, source_type, source_hash, base_dataset_version, scope_json,
  proposal_count, pending_count, created_by, created_at, updated_at
)
SELECT
  'review_batch_player_edition_20260727',
  '確認適用人數與版本／擴充',
  'manual',
  'retire-player-edition-tag-20260727',
  'post-0019',
  json_object('retiredTagId', 'tag_stage_edition'),
  COUNT(*),
  COUNT(*),
  (SELECT ur.user_id FROM user_roles ur
    WHERE ur.role = 'admin' AND ur.revoked_at IS NULL
    ORDER BY ur.granted_at LIMIT 1),
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM rule_tags
WHERE tag_id = 'tag_stage_edition'
HAVING COUNT(*) > 0;

WITH affected AS (
  SELECT r.*
  FROM rules r
  JOIN rule_tags rt ON rt.rule_id = r.id
  WHERE rt.tag_id = 'tag_stage_edition'
), review_content AS (
  SELECT
    r.id,
    r.updated_at,
    json_object(
      'statement', r.statement,
      'commonMistake', r.common_mistake,
      'details', r.details,
      'flowStage', r.flow_stage,
      'playerCounts', json(COALESCE(r.player_counts_json, '[]')),
      'playerCountNote', r.player_count_note,
      'editionNotes', json(COALESCE(r.edition_notes_json, '[]')),
      'editionNote', r.edition_note,
      'sourceLabel', r.source_label,
      'sourceUrl', r.source_url,
      'tagNames', json(COALESCE((
        SELECT json_group_array(t.name)
        FROM rule_tags remaining_rt
        JOIN tags t ON t.id = remaining_rt.tag_id
        WHERE remaining_rt.rule_id = r.id
          AND remaining_rt.tag_id <> 'tag_stage_edition'
      ), '[]'))
    ) AS content_json
  FROM affected r
)
INSERT INTO review_proposals (
  id, batch_id, target_id, operation, base_updated_at, base_content_hash,
  original_json, proposed_json, reason, status, created_by, created_at, updated_at
)
SELECT
  'review_player_edition_' || id,
  'review_batch_player_edition_20260727',
  id,
  'edit',
  updated_at,
  'manual-player-edition-review-' || id,
  content_json,
  content_json,
  '原「人數擴充」標籤已移除，請確認這條規則的適用人數與版本／擴充。',
  'pending',
  (SELECT ur.user_id FROM user_roles ur
    WHERE ur.role = 'admin' AND ur.revoked_at IS NULL
    ORDER BY ur.granted_at LIMIT 1),
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM review_content;

UPDATE rules
SET tag_ids_json = COALESCE((
  SELECT json_group_array(rt.tag_id)
  FROM rule_tags rt
  WHERE rt.rule_id = rules.id AND rt.tag_id <> 'tag_stage_edition'
), '[]')
WHERE id IN (SELECT rule_id FROM rule_tags WHERE tag_id = 'tag_stage_edition');

DELETE FROM rule_tags WHERE tag_id = 'tag_stage_edition';
DELETE FROM tag_aliases WHERE tag_id = 'tag_stage_edition';
DELETE FROM tags WHERE id = 'tag_stage_edition';
