import type { AttributeQuestionPayload, SubmissionInput } from '../shared/types';
import {
  attributeDirectRatingKey,
  attributeDirectRatingRecordsFromResponse,
  newestAttributeDirectRatingRecords,
  type AttributeDirectRatingInput
} from './attributeDirectRatings';
import type { AttributeQuestionCacheRecord, CacheRecord, DeferredAttributeSubject, DraftRecord, PendingAttributeResponse } from './localDbCore';
import { getDatabase, notifyPending } from './localDbCore';

let draftWrites: Promise<unknown> = Promise.resolve();
const writeDraft = <T,>(operation: () => Promise<T>) => {
  const result = draftWrites.then(operation, operation);
  draftWrites = result.catch(() => undefined);
  return result;
};

export const localDbEdits = {
  getDraft: async () => { await draftWrites; return (await getDatabase()).get('drafts', 'active'); },
  saveDraft: (draft: Omit<DraftRecord, 'id'>) => writeDraft(async () => (await getDatabase()).put('drafts', { ...draft, id: 'active' })),
  clearDraft: () => writeDraft(async () => (await getDatabase()).delete('drafts', 'active')),
  addPending: async (userId: string, payload: SubmissionInput) => { const result = await (await getDatabase()).put('pending', { id: payload.idempotencyKey, userId, payload, createdAt: Date.now() }); notifyPending(); return result; },
  removePending: async (id: string) => { await (await getDatabase()).delete('pending', id); notifyPending(); },
  getPending: async (userId: string) => (await (await getDatabase()).getAll('pending')).filter((item) => item.userId === userId),
  cacheAttributeQuestion: async (data: AttributeQuestionPayload, scope: 'all' | 'collection' = 'all') => (await getDatabase()).put('cache', { key: 'attributes:question:v1', data, scope, cachedAt: Date.now() }),
  getLatestAttributeQuestion: async () => (await getDatabase()).get('cache', 'attributes:question:v1') as Promise<AttributeQuestionCacheRecord | undefined>,
  invalidateAttributeQuestion: async () => {
    const db = await getDatabase();
    const cached = await db.get('cache', 'attributes:question:v1') as AttributeQuestionCacheRecord | undefined;
    if (cached) await db.put('cache', { ...cached, cachedAt: 0 });
  },
  getAttributeVoteScope: async () => {
    const cached = await (await getDatabase()).get('cache', 'attributes:vote-scope:v1') as CacheRecord<'all' | 'collection'> | undefined;
    return cached?.data === 'collection' ? 'collection' : 'all';
  },
  setAttributeVoteScope: async (scope: 'all' | 'collection') => (await getDatabase()).put('cache', { key: 'attributes:vote-scope:v1', data: scope, cachedAt: Date.now() }),
  replaceAttributeCollectionIds: async (bggIds: number[]) => {
    const db = await getDatabase();
    const transaction = db.transaction('attributeCollectionIds', 'readwrite');
    await transaction.store.clear();
    const importedAt = Date.now();
    for (const bggId of [...new Set(bggIds)]) await transaction.store.put({ bggId, importedAt });
    await transaction.done;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('attribute-collection-change'));
  },
  getAttributeCollectionIds: async () => (await getDatabase()).getAll('attributeCollectionIds').then((rows) => rows.map((row) => row.bggId)),
  clearAttributeCollectionIds: async () => {
    const db = await getDatabase();
    await db.clear('attributeCollectionIds');
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('attribute-collection-change'));
  },
  getAttributeQuestionNumber: async () => {
    const cached = await (await getDatabase()).get('cache', 'attributes:question-number:v1') as CacheRecord<number> | undefined;
    return Number.isSafeInteger(cached?.data) && Number(cached?.data) >= 0 ? Number(cached?.data) : 0;
  },
  getAttributeQuestionContext: async () => {
    const db = await getDatabase();
    const transaction = db.transaction(['cache', 'attributeDeferredSubjects'], 'readonly');
    const [cached, preferences] = await Promise.all([
      transaction.objectStore('cache').get('attributes:question-number:v1') as Promise<CacheRecord<number> | undefined>,
      transaction.objectStore('attributeDeferredSubjects').getAll(),
    ]);
    await transaction.done;
    const questionNumber = Number.isSafeInteger(cached?.data) && Number(cached?.data) >= 0 ? Number(cached?.data) : 0;
    const active = preferences.filter((preference) => preference.eligibleAfterQuestion > questionNumber);
    const expiredIds = preferences
      .filter((preference) => preference.eligibleAfterQuestion <= questionNumber)
      .map((preference) => preference.subjectId);
    if (expiredIds.length) {
      void (async () => {
        const cleanup = db.transaction('attributeDeferredSubjects', 'readwrite');
        await Promise.all(expiredIds.map(async (id) => {
          const current = await cleanup.store.get(id);
          if (current && current.eligibleAfterQuestion <= questionNumber) await cleanup.store.delete(id);
        }));
        await cleanup.done;
      })().catch(() => undefined);
    }
    return { questionNumber, deferred: active };
  },
  advanceAttributeQuestionNumber: async () => {
    const db = await getDatabase();
    const cached = await db.get('cache', 'attributes:question-number:v1') as CacheRecord<number> | undefined;
    const next = (Number.isSafeInteger(cached?.data) ? Number(cached?.data) : 0) + 1;
    await db.put('cache', { key: 'attributes:question-number:v1', data: next, cachedAt: Date.now() });
    return next;
  },
  getDeferredAttributeSubjects: async () => (await getDatabase()).getAll('attributeDeferredSubjects'),
  deferAttributeSubject: async (subjectId: string, bggIds: number[], questionNumber: number, questionDelay: number, timestamp = Date.now()) => {
    const db = await getDatabase();
    const current = await db.get('attributeDeferredSubjects', subjectId);
    const skipCount = (current?.skipCount ?? 0) + 1;
    const record: DeferredAttributeSubject = {
      subjectId,
      bggIds: [...new Set([...(current?.bggIds ?? []), ...bggIds].filter((id) => Number.isSafeInteger(id) && id > 0))],
      skipCount,
      skippedAt: timestamp,
      eligibleAfterQuestion: questionNumber + Math.max(1, Math.floor(questionDelay)),
      eligibleAfterAt: Number.MAX_SAFE_INTEGER,
    };
    await db.put('attributeDeferredSubjects', record);
    return record;
  },
  clearDeferredAttributeSubject: async (subjectId: string) => (await getDatabase()).delete('attributeDeferredSubjects', subjectId),
  addPendingAttributeResponse: async (payload: Omit<PendingAttributeResponse, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => {
    const item: PendingAttributeResponse = { ...payload, id: payload.id ?? payload.responseId, createdAt: payload.createdAt ?? Date.now() };
    return (await getDatabase()).put('attributeResponses', item);
  },
  getPendingAttributeResponses: async () => (await getDatabase()).getAll('attributeResponses'),
  removePendingAttributeResponse: async (id: string) => (await getDatabase()).delete('attributeResponses', id),
  getAttributeDirectRatingKeys: async (ownerId: string) => {
    const records = await (await getDatabase()).getAllFromIndex('attributeDirectRatings', 'ownerId', ownerId);
    return newestAttributeDirectRatingRecords(records).map((record) => attributeDirectRatingKey(record.subjectId, record.attributeId));
  },
  recordAttributeDirectRatings: async (ownerId: string, input: AttributeDirectRatingInput, ratedAt = Date.now()) => {
    const records = attributeDirectRatingRecordsFromResponse(ownerId, input, ratedAt);
    if (!records.length) return [];
    const db = await getDatabase();
    const transaction = db.transaction('attributeDirectRatings', 'readwrite');
    await Promise.all(records.map((record) => transaction.store.put(record)));
    const owned = await transaction.store.index('ownerId').getAll(ownerId);
    const retainedKeys = new Set(newestAttributeDirectRatingRecords(owned).map((record) => record.key));
    await Promise.all(owned
      .filter((record) => !retainedKeys.has(record.key))
      .map((record) => transaction.store.delete(record.key)));
    await transaction.done;
    return records.map((record) => attributeDirectRatingKey(record.subjectId, record.attributeId));
  },
};
