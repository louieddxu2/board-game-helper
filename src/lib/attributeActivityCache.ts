import type { AttributeActivity } from '../shared/types';
import { getDatabase } from './localDbCore';

const KEY = 'attributes:activities:v1';
export const ATTRIBUTE_ACTIVITIES_FRESH_MS = 5 * 60 * 1000;
type ActivityData = { server: AttributeActivity[]; confirmed: AttributeActivity[] };
export type ActivityCache = { key: string; data: ActivityData; cachedAt: number };

export const mergeAttributeActivities = (...lists: AttributeActivity[][]): AttributeActivity[] => {
  const seen = new Set<string>();
  return lists.flat().filter((item) => item.kind === 'comparison')
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((item) => {
      const key = item.responseId ?? item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);
};

// The POST response contains separate comparison and rating entries.
export const confirmedComparisons = (activities: AttributeActivity[], responseId: string): AttributeActivity[] => {
  const ratings = new Map(activities.filter((item) => item.kind === 'rating' && item.subject && item.value != null)
    .map((item) => [item.subject!.id, item.value!]));
  return activities.filter((item) => item.kind === 'comparison').reverse().flatMap((comparison) => {
    if (!comparison.subjectA || !comparison.subjectB) return [];
    return [{ ...comparison, responseId: comparison.responseId ?? responseId,
      ratingA: comparison.ratingA ?? ratings.get(comparison.subjectA.id),
      ratingB: comparison.ratingB ?? ratings.get(comparison.subjectB.id) }];
  });
};

export const confirmedComparison = (activities: AttributeActivity[], responseId: string): AttributeActivity | undefined =>
  confirmedComparisons(activities, responseId)[0];

export const attributeActivityCache = {
  getAttributeActivities: async () => (await (await getDatabase()).get('cache', KEY)) as ActivityCache | undefined,
  updateAttributeActivities: async (update: { server?: AttributeActivity[]; confirmed?: AttributeActivity | AttributeActivity[]; invalidate?: boolean }) => {
    const db = await getDatabase();
    const tx = db.transaction('cache', 'readwrite');
    const previous = await tx.store.get(KEY) as ActivityCache | undefined;
    const confirmed = update.confirmed ? mergeAttributeActivities(Array.isArray(update.confirmed) ? update.confirmed : [update.confirmed], previous?.data.confirmed ?? []) : previous?.data.confirmed ?? [];
    const server = update.server ?? previous?.data.server ?? [];
    const entry: ActivityCache = { key: KEY, data: { server, confirmed }, cachedAt: update.invalidate ? 0 : update.server ? Date.now() : previous?.cachedAt ?? 0 };
    await tx.store.put(entry);
    await tx.done;
    return entry;
  },
};
