import { acquireAttributeMergeLock, canonicalizeAttributeMergeVoteSubjects, releaseAttributeMergeLock } from './attributeLocks';
import { createId, normalizeText } from '../utils';
import type { Database } from './database';

/** One merge implementation for the authenticated route and authorized maintenance tools. */
export const mergeGames = async (queryDb: Database, sourceGameId: string, targetGameId: string, timestamp = Date.now()) => {
  if (sourceGameId === targetGameId) throw new Error('invalid_merge');
  const [source, target] = await Promise.all([
    queryDb.statement('SELECT * FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(sourceGameId).first<Record<string, unknown>>(),
    queryDb.statement('SELECT * FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(targetGameId).first<Record<string, unknown>>(),
  ]);
  if (!source || !target) throw new Error('game_not_found');
  const mergeLock = await acquireAttributeMergeLock(queryDb, sourceGameId, targetGameId, timestamp);
  try {
    if (mergeLock.sourceSubjectId && !mergeLock.targetSubjectId) {
      throw new Error('attribute_merge_target_subject_missing');
    }
    const canonicalizeVotes = canonicalizeAttributeMergeVoteSubjects(
      queryDb,
      mergeLock.sourceSubjectId,
      mergeLock.targetSubjectId,
    );
    await queryDb.batch([
      queryDb.statement(`
        INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
        VALUES (?, ?, ?, ?, 'legacy', ?)
      `).bind(createId('alias'), targetGameId, String(source.display_name), normalizeText(String(source.display_name)), timestamp),
      queryDb.statement(`
        INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
        SELECT 'm_' || id, ?, alias, normalized_alias, 'legacy', ? FROM game_aliases WHERE game_id = ?
      `).bind(targetGameId, timestamp, sourceGameId),
      queryDb.statement(`
        INSERT INTO game_daily_view_counts (game_id, view_date, view_count, last_view_at)
        SELECT ?, view_date, view_count, last_view_at
        FROM game_daily_view_counts
        WHERE game_id = ?
        ON CONFLICT(game_id, view_date) DO UPDATE SET
          view_count = game_daily_view_counts.view_count + excluded.view_count,
          last_view_at = MAX(game_daily_view_counts.last_view_at, excluded.last_view_at)
      `).bind(targetGameId, sourceGameId),
      queryDb.statement('DELETE FROM game_daily_view_counts WHERE game_id = ?').bind(sourceGameId),
      queryDb.statement('DELETE FROM game_view_dedup WHERE game_id = ?').bind(sourceGameId),
      queryDb.statement(`
        UPDATE user_game_favorites
        SET seen_rule_updated_at = MAX(seen_rule_updated_at, COALESCE((
              SELECT source.seen_rule_updated_at FROM user_game_favorites source
              WHERE source.user_id = user_game_favorites.user_id AND source.game_id = ?
            ), seen_rule_updated_at)),
            created_at = MAX(created_at, COALESCE((
              SELECT source.created_at FROM user_game_favorites source
              WHERE source.user_id = user_game_favorites.user_id AND source.game_id = ?
            ), created_at))
        WHERE game_id = ?
      `).bind(sourceGameId, sourceGameId, targetGameId),
      queryDb.statement(`
        DELETE FROM user_game_favorites
        WHERE game_id = ? AND EXISTS (
          SELECT 1 FROM user_game_favorites target
          WHERE target.user_id = user_game_favorites.user_id AND target.game_id = ?
        )
      `).bind(sourceGameId, targetGameId),
      queryDb.statement('UPDATE user_game_favorites SET game_id = ? WHERE game_id = ?')
        .bind(targetGameId, sourceGameId),
      queryDb.statement('UPDATE rule_importance_votes SET game_id = ? WHERE game_id = ?')
        .bind(targetGameId, sourceGameId),
      queryDb.statement('UPDATE submissions SET game_id = ? WHERE game_id = ?').bind(targetGameId, sourceGameId),
      queryDb.statement('UPDATE rules SET game_id = ?, updated_at = ? WHERE game_id = ?').bind(targetGameId, timestamp, sourceGameId),
      queryDb.statement(`
        UPDATE attribute_subject_components
        SET game_id = ?, label = (SELECT display_name FROM games WHERE id = ?)
        WHERE game_id = ? AND component_type IN ('base', 'expansion')
      `).bind(targetGameId, targetGameId, sourceGameId),
      ...(canonicalizeVotes ? [canonicalizeVotes] : []),
      queryDb.statement(`
        DELETE FROM game_entity_relations
        WHERE target_game_id = ?
          AND EXISTS (
            SELECT 1
            FROM game_entity_relations existing
            WHERE existing.source_game_id = game_entity_relations.source_game_id
              AND existing.target_game_id = ?
              AND existing.relation_type = game_entity_relations.relation_type
          )
      `).bind(sourceGameId, targetGameId),
      queryDb.statement(`
        UPDATE game_entity_relations
        SET target_game_id = ?
        WHERE target_game_id = ?
      `).bind(targetGameId, sourceGameId),
      queryDb.statement('UPDATE games SET merged_into_game_id = ?, updated_at = ? WHERE id = ?').bind(targetGameId, timestamp, sourceGameId),
      queryDb.statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, targetGameId),
    ]);
    const updatedTarget = await queryDb.statement(`
      SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at, g.entity_kind,
        g.published_rule_count AS rule_count, g.published_rule_count,
        g.total_rule_count, g.latest_rule_updated_at,
        GROUP_CONCAT(DISTINCT a.alias) AS aliases_str
      FROM games g
      LEFT JOIN game_aliases a ON a.game_id = g.id
      WHERE g.id = ?
      GROUP BY g.id
    `).bind(targetGameId).first<Record<string, unknown>>();
    return {
      ok: true,
      sourceGameId,
      targetGameId,
      sourceGame: source,
      targetGame: updatedTarget!,
    };
  } finally {
    await releaseAttributeMergeLock(queryDb, mergeLock);
  }
};
