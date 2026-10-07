import type {
  AttributeActivity
} from '../../src/shared/types';
import type { ActivityFeedRow } from './attributeQueryShared';
import { ATTRIBUTE_ACTIVITY_FEED_LIMIT } from './attributeQueryShared';
import type { Database } from './database';

export const parseAttributeActivityFeedEntry = (raw: string, responseId?: string): AttributeActivity[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const activities = parsed.filter((item): item is AttributeActivity => Boolean(item && typeof item === 'object' && 'id' in item && 'kind' in item));
    const comparison = activities.find((item) => item.kind === 'comparison');
    if (!comparison?.subjectA || !comparison.subjectB) return [];
    const ratings = new Map(activities
      .filter((item) => item.kind === 'rating' && item.subject && item.value != null)
      .map((item) => [item.subject!.id, item.value!]));
    return [{
      ...comparison,
      ...(responseId || comparison.responseId ? { responseId: responseId ?? comparison.responseId } : {}),
      ratingA: comparison.ratingA ?? ratings.get(comparison.subjectA.id),
      ratingB: comparison.ratingB ?? ratings.get(comparison.subjectB.id),
    }];
  } catch {
    return [];
  }
};

export const queryRecentActivities = async (db: Database): Promise<AttributeActivity[]> => {
  const result = await db.statement(`
    SELECT response_id AS id, activity_json AS payload_json
    FROM attribute_vote_responses
    JOIN attributes active_attribute
      ON active_attribute.id = attribute_vote_responses.attribute_id
      AND active_attribute.is_active = 1
    ORDER BY created_at DESC, response_id DESC
    LIMIT ${ATTRIBUTE_ACTIVITY_FEED_LIMIT}
  `).all<ActivityFeedRow>();
  const activities = (result.results ?? [])
    .flatMap((row) => parseAttributeActivityFeedEntry(row.payload_json, row.id))
    .slice(0, ATTRIBUTE_ACTIVITY_FEED_LIMIT);
  // activity_json already contains the display snapshot shown to users.  Do
  // not re-hydrate every subject through the derived-name and voting-boundary
  // views on every question request; that turns a 12-row feed into a table
  // scan as the collection grows.
  return activities;
};

export const cleanupAttributeActivityFeed = async (db: Database): Promise<void> => {
  await db.statement(`
    DELETE FROM attribute_activity_feed
    WHERE id NOT IN (
      SELECT id FROM attribute_activity_feed
      ORDER BY created_at DESC, id DESC
      LIMIT 500
    )
  `).run();
};
