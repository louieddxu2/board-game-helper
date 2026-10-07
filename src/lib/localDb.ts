import { localDbAttributes } from './localDbAttributes';
import { localDbCatalogs } from './localDbCatalogs';
import { localDbContent } from './localDbContent';
import { localDbEdits } from './localDbEdits';
export { applyAttributeValueUpdates, applyGameCatalogChangesToCache, applyGameReferenceUpdate, isCachedRuleSetUsable, PUBLIC_TAG_CATALOG_FRESH_MS, RULE_IMPORTANCE_CACHE_FRESH_MS, toStoredRule } from './localDbCore';

export type { AttributeCatalogCacheRecord, AttributeQuestionCacheRecord, CachedGameRow, CachedRuleRow, CachedRuleUpdate, DeferredAttributeSubject, DraftRecord, GameCatalogCacheRecord, PendingAttributeResponse, RuleEntity, TagCacheRecord } from './localDbCore';

/** All callers and test spies share this one API object and database session. */
export const localDb = {
  ...localDbEdits,
  ...localDbCatalogs,
  ...localDbAttributes,
  ...localDbContent,
};
