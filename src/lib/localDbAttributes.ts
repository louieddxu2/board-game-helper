import type { AttributeCatalogChangesPayload, AttributeCatalogPayload, AttributeMatrixValue } from '../shared/types';
import { applyAttributeCatalogChanges, mergeAttributeSubjectMetadata } from './attributeCatalog';
import type { AttributeCatalogMetaRecord, GameCatalogCacheRecord } from './localDbCore';
import { applyAttributeValueUpdates, ATTRIBUTE_CATALOG_META_KEY, attributeCatalogMetaFromPayload, attributeCatalogPayloadFromStores, attributeCatalogValueKey, CATALOG_SYNC_FRESH_MS, getDatabase, localDbMemory, PUBLIC_ATTRIBUTE_TABLE_KEY, PUBLIC_GAME_CATALOG_KEY } from './localDbCore';

export const localDbAttributes = {
  cacheAttributeCatalog: async (data: AttributeCatalogPayload) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    const transaction = db.transaction([
      'attributeCatalogMeta', 'attributeCatalogAttributes', 'attributeCatalogSubjects',
      'attributeCatalogValues', 'attributeCatalogCandidates',
    ], 'readwrite');
    await Promise.all([
      transaction.objectStore('attributeCatalogMeta').clear(),
      transaction.objectStore('attributeCatalogAttributes').clear(),
      transaction.objectStore('attributeCatalogSubjects').clear(),
      transaction.objectStore('attributeCatalogValues').clear(),
      transaction.objectStore('attributeCatalogCandidates').clear(),
    ]);
    await transaction.objectStore('attributeCatalogMeta').put(attributeCatalogMetaFromPayload(data, cachedAt));
    await Promise.all([
      ...data.attributes.map((attribute) => transaction.objectStore('attributeCatalogAttributes').put(attribute)),
      ...data.subjects.map((subject) => transaction.objectStore('attributeCatalogSubjects').put(subject)),
      ...data.values.map((value) => transaction.objectStore('attributeCatalogValues').put({ ...value, key: attributeCatalogValueKey(value) })),
      ...data.candidates.map((candidate) => transaction.objectStore('attributeCatalogCandidates').put(candidate)),
    ]);
    await transaction.done;
    localDbMemory.attributeTableMemoryCache = {
      key: PUBLIC_ATTRIBUTE_TABLE_KEY,
      data,
      cachedAt,
      snapshotFetchedAt: cachedAt,
    };
  },
  getSynchronizedAttributeCatalog: async () => {
    if (localDbMemory.attributeTableMemoryCache && Date.now() - localDbMemory.attributeTableMemoryCache.cachedAt < CATALOG_SYNC_FRESH_MS) return localDbMemory.attributeTableMemoryCache;
    const db = await getDatabase();
    const meta = await db.get('attributeCatalogMeta', ATTRIBUTE_CATALOG_META_KEY);
    if (!meta || Date.now() - meta.cachedAt >= CATALOG_SYNC_FRESH_MS) return undefined;
    const data = await attributeCatalogPayloadFromStores(db, meta);
    if (!data) return undefined;
    localDbMemory.attributeTableMemoryCache = {
      key: PUBLIC_ATTRIBUTE_TABLE_KEY,
      data,
      cachedAt: meta.cachedAt,
      snapshotFetchedAt: meta.snapshotFetchedAt,
    };
    return localDbMemory.attributeTableMemoryCache;
  },
  getLatestAttributeCatalog: async () => {
    if (localDbMemory.attributeTableMemoryCache) return localDbMemory.attributeTableMemoryCache;
    const db = await getDatabase();
    const meta = await db.get('attributeCatalogMeta', ATTRIBUTE_CATALOG_META_KEY);
    if (!meta) return undefined;
    const data = await attributeCatalogPayloadFromStores(db, meta);
    if (!data) return undefined;
    localDbMemory.attributeTableMemoryCache = {
      key: PUBLIC_ATTRIBUTE_TABLE_KEY,
      data,
      cachedAt: meta.cachedAt,
      snapshotFetchedAt: meta.snapshotFetchedAt,
    };
    return localDbMemory.attributeTableMemoryCache;
  },
  cacheAttributeCatalogChanges: async (data: AttributeCatalogChangesPayload) => {
    const db = await getDatabase();
    const current = await db.get('attributeCatalogMeta', ATTRIBUTE_CATALOG_META_KEY);
    if (!current) throw new Error('attribute_catalog_cache_missing');
    const nextMeta: AttributeCatalogMetaRecord = {
      ...current,
      throughVersion: Math.max(current.throughVersion, data.throughVersion),
      cachedAt: data.hasMore ? current.cachedAt : Date.now(),
      activities: [],
    };
    const transaction = db.transaction([
      'attributeCatalogMeta', 'attributeCatalogAttributes', 'attributeCatalogSubjects',
      'attributeCatalogValues', 'attributeCatalogCandidates',
    ], 'readwrite');
    const attributes = transaction.objectStore('attributeCatalogAttributes');
    const subjects = transaction.objectStore('attributeCatalogSubjects');
    const values = transaction.objectStore('attributeCatalogValues');
    const candidates = transaction.objectStore('attributeCatalogCandidates');
    for (const change of data.changes) {
      if (change.entryKey.startsWith('attribute:')) {
        const attributeId = change.entryKey.slice('attribute:'.length);
        if (change.deleted) {
          await attributes.delete(attributeId);
          const attributeValues = await values.index('attributeId').getAll(attributeId);
          await Promise.all(attributeValues.map((value) => values.delete(value.key)));
        } else if (change.attribute) {
          await attributes.put(change.attribute);
        }
      } else if (change.entryKey.startsWith('subject:')) {
        const subjectId = change.entryKey.slice('subject:'.length);
        if (change.deleted) {
          await subjects.delete(subjectId);
          const subjectValues = await values.index('subjectId').getAll(subjectId);
          await Promise.all(subjectValues.map((value) => values.delete(value.key)));
        } else if (change.subject) {
          const currentSubject = await subjects.get(subjectId);
          await subjects.put(mergeAttributeSubjectMetadata(currentSubject, change.subject));
          if (change.values !== undefined) {
            const subjectValues = await values.index('subjectId').getAll(subjectId);
            await Promise.all(subjectValues.map((value) => values.delete(value.key)));
            await Promise.all(change.values
              .filter((value) => value.subjectId === change.subject!.id)
              .map((value) => values.put({ ...value, key: attributeCatalogValueKey(value) })));
          }
        }
      } else if (change.entryKey.startsWith('value:')) {
        if (change.deleted) {
          const [, subjectId, attributeId] = change.entryKey.match(/^value:([^:]+):(.+)$/) ?? [];
          if (subjectId && attributeId) await values.delete(attributeCatalogValueKey({ subjectId, attributeId }));
        } else if (change.value) {
          await values.put({ ...change.value, key: attributeCatalogValueKey(change.value) });
          if (change.subject) {
            const currentSubject = await subjects.get(change.subject.id);
            await subjects.put(mergeAttributeSubjectMetadata(currentSubject, change.subject));
          }
        }
      } else if (change.entryKey.startsWith('candidate:')) {
        const candidateId = change.candidate?.id ?? change.entryKey.slice('candidate:'.length);
        if (change.deleted || !change.candidate || !['pending', 'ambiguous'].includes(change.candidate.matchStatus)) {
          await candidates.delete(candidateId);
        } else {
          await candidates.put(change.candidate);
        }
      }
    }
    await transaction.objectStore('attributeCatalogMeta').put(nextMeta);
    await transaction.done;
    if (localDbMemory.attributeTableMemoryCache) {
      localDbMemory.attributeTableMemoryCache = {
        ...localDbMemory.attributeTableMemoryCache,
        data: applyAttributeCatalogChanges(localDbMemory.attributeTableMemoryCache.data, data.changes, data.throughVersion),
        cachedAt: nextMeta.cachedAt,
        snapshotFetchedAt: nextMeta.snapshotFetchedAt,
      };
    }
  },
  updateAttributeCatalogValues: async (values: AttributeMatrixValue[]) => {
    if (!values.length) return;
    const db = await getDatabase();
    const current = await db.get('attributeCatalogMeta', ATTRIBUTE_CATALOG_META_KEY);
    if (!current) return;
    const transaction = db.transaction('attributeCatalogValues', 'readwrite');
    await Promise.all(values.map((value) => transaction.store.put({ ...value, key: attributeCatalogValueKey(value) })));
    await transaction.done;
    if (localDbMemory.attributeTableMemoryCache) {
      localDbMemory.attributeTableMemoryCache = {
        ...localDbMemory.attributeTableMemoryCache,
        data: applyAttributeValueUpdates(localDbMemory.attributeTableMemoryCache.data, values),
      };
    }
  },
  invalidateAttributeCatalogSync: async () => {
    const db = await getDatabase();
    const current = await db.get('attributeCatalogMeta', ATTRIBUTE_CATALOG_META_KEY);
    if (!current) return;
    const invalidated = { ...current, cachedAt: 0 };
    localDbMemory.attributeTableMemoryCache = localDbMemory.attributeTableMemoryCache ? { ...localDbMemory.attributeTableMemoryCache, cachedAt: 0 } : undefined;
    await db.put('attributeCatalogMeta', invalidated);
  },
  invalidateGameCatalogSync: async () => {
    const db = await getDatabase();
    const cached = await db.get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (!cached) return;
    const invalidated = { ...cached, cachedAt: 0 };
    localDbMemory.gameCatalogMemoryCache = invalidated;
    await db.put('cache', invalidated);
  },
};
