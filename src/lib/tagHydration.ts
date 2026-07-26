import { api } from './api';
import { localDb } from './localDb';
import type { GameDetail, RuleCard, TagSummary } from '../shared/types';

const TAG_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
const tagBatchPromises = new Map<string, Promise<TagSummary[]>>();

const uniqueTagIds = (rules: RuleCard[]) => Array.from(new Set(
  rules.flatMap((rule) => rule.tagIds ?? []),
));

const fetchTagBatch = (ids: string[]) => {
  const key = ids.join(',');
  const existing = tagBatchPromises.get(key);
  if (existing) return existing;
  const request = api.tags(ids).then((response) => response.tags).finally(() => {
    if (tagBatchPromises.get(key) === request) tagBatchPromises.delete(key);
  });
  tagBatchPromises.set(key, request);
  return request;
};

export const hydrateRuleTags = async <T extends RuleCard>(rules: T[]): Promise<T[]> => {
  const tagIds = uniqueTagIds(rules);
  const tagMap = new Map<string, TagSummary>();

  for (const rule of rules) {
    for (const tag of rule.tags ?? []) tagMap.set(tag.id, tag);
  }

  const now = Date.now();
  if (!tagIds.length) {
    await localDb.cacheTagEntities(Array.from(tagMap.values())).catch(() => undefined);
    return rules;
  }

  const cachedRecords = await localDb.getCachedTagEntities(tagIds).catch(() => []);
  const cachedIds = new Set<string>();
  const staleIds: string[] = [];
  for (const record of cachedRecords) {
    tagMap.set(record.data.id, record.data);
    cachedIds.add(record.data.id);
    if (now - record.cachedAt >= TAG_CACHE_FRESH_MS) staleIds.push(record.data.id);
  }

  const publicTags = await localDb.getCachedPublicTags().catch(() => undefined);
  if (publicTags && now - publicTags.cachedAt < TAG_CACHE_FRESH_MS) {
    const publicTagMap = new Map(publicTags.data.tags.map((tag) => [tag.id, tag]));
    const fromPublicCache = tagIds.filter((id) => publicTagMap.has(id)).map((id) => publicTagMap.get(id)!);
    fromPublicCache.forEach((tag) => tagMap.set(tag.id, tag));
    await localDb.cacheTagEntities(fromPublicCache).catch(() => undefined);
  }

  const idsToFetch = tagIds.filter((id) => !cachedIds.has(id) || staleIds.includes(id))
    .filter((id) => !publicTags || !publicTags.data.tags.some((tag) => tag.id === id && now - publicTags.cachedAt < TAG_CACHE_FRESH_MS))
    .sort();

  if (idsToFetch.length) {
    try {
      const tags = await fetchTagBatch(idsToFetch);
      await localDb.cacheTagEntities(tags).catch(() => undefined);
      tags.forEach((tag) => tagMap.set(tag.id, tag));
    } catch {
      // Existing cached tag data remains usable while a revalidation fails.
    }
  }

  return rules.map((rule) => ({
    ...rule,
    tags: (rule.tagIds ?? []).map((id) => tagMap.get(id)).filter((tag): tag is TagSummary => Boolean(tag)),
  }));
};

export const hydrateGameTags = async (game: GameDetail): Promise<GameDetail> => ({
  ...game,
  rules: await hydrateRuleTags(game.rules),
});
