import { api } from './api';
import type { GameDetail, RuleCard, TagSummary } from '../shared/types';

const tagBatchPromises = new Map<string, Promise<TagSummary[]>>();

const unresolvedTag = (id: string): TagSummary => ({
  id,
  slug: id,
  name: '未知標籤',
  unresolved: true,
});

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

  if (tagIds.length) {
    try {
      const tags = await fetchTagBatch(tagIds.sort());
      tags.forEach((tag) => tagMap.set(tag.id, tag));
    } catch {
      // Existing tag data embedded in the rule remains usable while a lookup fails.
    }
  }

  return rules.map((rule) => ({
    ...rule,
    tags: (rule.tagIds ?? []).map((id) => tagMap.get(id) ?? unresolvedTag(id)),
  }));
};

export const hydrateGameTags = async (game: GameDetail): Promise<GameDetail> => ({
  ...game,
  rules: await hydrateRuleTags(game.rules),
});
