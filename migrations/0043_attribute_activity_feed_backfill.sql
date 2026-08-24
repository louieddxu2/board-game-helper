-- Make the recent activity feed useful immediately after upgrading.  One
-- response can have up to three event rows, so aggregate them into one feed
-- row and keep the raw append-only event stream untouched.
INSERT OR IGNORE INTO attribute_activity_feed (id, response_id, payload_json, created_at)
SELECT
  'attribute-feed:backfill:' || v.response_id,
  v.response_id,
  json_group_array(
    CASE WHEN v.kind = 'rating' THEN json_object(
      'id', v.id,
      'kind', v.kind,
      'actorName', CASE WHEN u.show_nickname = 1 AND u.nickname IS NOT NULL THEN u.nickname ELSE '匿名玩家' END,
      'attributeId', v.attribute_id,
      'attributeName', t.name,
      'subject', json_object('id', sa.id, 'displayName', sa.display_name, 'slug', sa.slug, 'gameSlug', ga.slug),
      'value', v.value,
      'createdAt', v.created_at
    ) ELSE json_object(
      'id', v.id,
      'kind', v.kind,
      'actorName', CASE WHEN u.show_nickname = 1 AND u.nickname IS NOT NULL THEN u.nickname ELSE '匿名玩家' END,
      'attributeId', v.attribute_id,
      'attributeName', t.name,
      'subjectA', json_object('id', sa.id, 'displayName', sa.display_name, 'slug', sa.slug, 'gameSlug', ga.slug),
      'subjectB', json_object('id', sb.id, 'displayName', sb.display_name, 'slug', sb.slug, 'gameSlug', gb.slug),
      'result', v.result,
      'createdAt', v.created_at
    ) END
  ),
  MAX(v.created_at)
FROM attribute_vote_events v
JOIN attribute_translations t ON t.attribute_id = v.attribute_id AND t.locale = 'zh-TW'
JOIN attribute_subjects sa ON sa.id = v.subject_a_id
LEFT JOIN attribute_subjects sb ON sb.id = v.subject_b_id
LEFT JOIN games ga ON ga.id = sa.game_id
LEFT JOIN games gb ON gb.id = sb.game_id
LEFT JOIN users u ON u.id = v.actor_id
WHERE v.session_id NOT LIKE 'seed:%'
GROUP BY v.response_id;
