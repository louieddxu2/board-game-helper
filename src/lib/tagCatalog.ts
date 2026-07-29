import type { PublicTagCatalogChange, TagSummary } from '../shared/types';

export const applyPublicTagCatalogChanges = (
  tags: TagSummary[],
  changes: PublicTagCatalogChange[],
): TagSummary[] => {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  for (const change of changes) {
    if (change.deleted) byId.delete(change.tagId);
    else if (change.tag) byId.set(change.tagId, change.tag);
  }
  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
};
