import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SessionContext } from '../context/SessionContext';
import { api, ApiError } from '../lib/api';
import { attributeSubjectBggIds, availableAttributeSubjectIds, chooseScopedAttributeQuestion, chooseScopedExtremeExamples, matchCollectionSubjects } from '../lib/attributeCollection';
import { attributeDirectRatingKey, attributeDirectRatingKeysFromResponse } from '../lib/attributeDirectRatings';
import { createAttributeResponseId, getAttributeSessionId } from '../lib/attributeSession';
import { applyAttributeValueUpdates, localDb, type PendingAttributeResponse } from '../lib/localDb';
import { chooseAttributeHighPole } from '../shared/attributeScale';
import type { AttributeActivity, AttributeCatalogPayload, AttributeComparisonResult, AttributeQuestion, AttributeQuestionPayload } from '../shared/types';
import type { AttributeResponseDraft, AttributeVoteScope, ConnectionState, QuestionMotion, VoteFeedback } from './attributesPageShared';
import { ATTRIBUTE_QUESTION_CACHE_FRESH_MS, attributeQuestionKey, browserIsOffline, comparisonChoiceText, connectionStateAfterFailure, OPTIMISTIC_ACTIVITY_LIMIT, optimisticComparisonActivity, QUESTION_ENTER_MS, QUESTION_EXIT_MS, questionOptions, reducedMotion, SAVED_FEEDBACK_MS, wait } from './attributesPageShared';
import { useAttributeCollectionImport } from './useAttributeCollectionImport';

export const useAttributesPage = () => {
  const session = useContext(SessionContext);
  const [payload, setPayload] = useState<AttributeQuestionPayload>();
  const [question, setQuestion] = useState<AttributeQuestion>();
  const [optimisticActivities, setOptimisticActivities] = useState<AttributeActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [responseError, setResponseError] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>(() => browserIsOffline() ? 'offline' : 'online');
  const [pendingCount, setPendingCount] = useState(0);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [comparison, setComparison] = useState<AttributeComparisonResult | null>(null);
  const [comparisonQuestionKey, setComparisonQuestionKey] = useState('');
  const [ratingA, setRatingA] = useState('');
  const [ratingB, setRatingB] = useState('');
  const [questionMotion, setQuestionMotion] = useState<QuestionMotion>('idle');
  const [voteFeedback, setVoteFeedback] = useState<VoteFeedback>(null);
  const [collectionIds, setCollectionIds] = useState<number[]>([]);
  const [collectionMatchCount, setCollectionMatchCount] = useState(0);
  const [collectionMatchKnown, setCollectionMatchKnown] = useState(false);
  const [voteScope, setVoteScope] = useState<AttributeVoteScope>('all');
  const [scopeLoading, setScopeLoading] = useState(false);
  const [collectionMessage, setCollectionMessage] = useState('');
  const [collectionImporting, setCollectionImporting] = useState(false);
  const [sessionId] = useState(getAttributeSessionId);
  const recentActivitiesRef = useRef<AttributeActivity[]>([]);
  const collectionIdsRef = useRef<number[]>([]);
  const votingCatalogRef = useRef<Awaited<ReturnType<typeof api.attributeTable>> | undefined>(undefined);
  const collectionMatchCacheRef = useRef<{ subjects: AttributeCatalogPayload['subjects']; bggIds: number[]; result: ReturnType<typeof matchCollectionSubjects> } | undefined>(undefined);
  const directRatingKeysRef = useRef(new Set<string>());
  const voteScopeRef = useRef<AttributeVoteScope>('all');
  const collectionInputRef = useRef<HTMLInputElement>(null);
  const responseIdRef = useRef<string | undefined>(undefined);
  const syncingRef = useRef(false);
  const inFlightResponseIdsRef = useRef(new Set<string>());
  const motionTimerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const getCollectionMatch = useCallback((catalog: AttributeCatalogPayload, bggIds: number[]) => {
    const cached = collectionMatchCacheRef.current;
    if (cached?.subjects === catalog.subjects
      && cached.bggIds === bggIds) return cached.result;
    const result = matchCollectionSubjects(catalog, bggIds);
    collectionMatchCacheRef.current = { subjects: catalog.subjects, bggIds, result };
    return result;
  }, []);
  const optimisticActorName = session?.user?.showNickname && session.user.nickname?.trim()
    ? session.user.nickname.trim()
    : '匿名玩家';

  const clearResponse = () => {
    setComparison(null);
    setComparisonQuestionKey('');
    setRatingA('');
    setRatingB('');
    setResponseError('');
  };

  const applyQuestionPayload = useCallback((nextPayload: AttributeQuestionPayload, scope: AttributeVoteScope = voteScopeRef.current) => {
    setPayload(nextPayload);
    recentActivitiesRef.current = nextPayload.activities;
    setQuestion(nextPayload.question ?? undefined);
    const confirmedResponseIds = new Set(nextPayload.activities.map((activity) => activity.responseId).filter((id): id is string => Boolean(id)));
    if (confirmedResponseIds.size) {
      setOptimisticActivities((current) => current
        .filter((activity) => !activity.responseId || !confirmedResponseIds.has(activity.responseId))
        .slice(0, OPTIMISTIC_ACTIVITY_LIMIT));
    }
    responseIdRef.current = undefined;
    setAwaitingNext(false);
    clearResponse();
    void localDb.cacheAttributeQuestion(nextPayload, scope).catch(() => undefined);
  }, []);

  const animateQuestionChange = useCallback(async (nextPayload: AttributeQuestionPayload, mode: 'pair' | 'a' | 'b' = 'pair') => {
    if (!mountedRef.current) return;
    if (motionTimerRef.current !== undefined) window.clearTimeout(motionTimerRef.current);
    const noMotion = reducedMotion();
    setQuestionMotion(mode === 'pair' ? 'leaving' : mode === 'a' ? 'leaving-a' : 'leaving-b');
    if (!noMotion) await wait(QUESTION_EXIT_MS);
    if (!mountedRef.current) return;
    applyQuestionPayload(nextPayload);
    setVoteFeedback(null);
    setQuestionMotion(mode === 'pair' ? 'entering' : mode === 'a' ? 'entering-a' : 'entering-b');
    if (noMotion) {
      setQuestionMotion('idle');
      return;
    }
    motionTimerRef.current = window.setTimeout(() => {
      setQuestionMotion('idle');
      motionTimerRef.current = undefined;
    }, QUESTION_ENTER_MS);
  }, [applyQuestionPayload]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (motionTimerRef.current !== undefined) window.clearTimeout(motionTimerRef.current);
    };
  }, []);

  const refreshPendingCount = useCallback(async () => {
    const pending = await localDb.getPendingAttributeResponses().catch(() => [] as PendingAttributeResponse[]);
    setPendingCount(pending.length);
    return pending;
  }, []);

  const loadVotingCatalog = useCallback(async () => {
    if (votingCatalogRef.current) return votingCatalogRef.current;
    const catalog = await api.attributeTable((updated) => {
      votingCatalogRef.current = updated;
      const ids = collectionIdsRef.current;
      if (ids.length) {
        setCollectionMatchCount(getCollectionMatch(updated, ids).matchedBggIds.length);
        setCollectionMatchKnown(true);
      }
    });
    votingCatalogRef.current = catalog;
    if (!recentActivitiesRef.current.length) recentActivitiesRef.current = catalog.activities ?? [];
    return catalog;
  }, [getCollectionMatch]);

  const refreshCollectionScope = useCallback(async () => {
    const ids = await localDb.getAttributeCollectionIds();
    collectionIdsRef.current = ids;
    setCollectionIds(ids);
    setCollectionMatchKnown(false);
    if (!ids.length) {
      setCollectionMatchCount(0);
      return;
    }
    const catalog = await loadVotingCatalog();
    setCollectionMatchCount(getCollectionMatch(catalog, ids).matchedBggIds.length);
    setCollectionMatchKnown(true);
  }, [getCollectionMatch, loadVotingCatalog]);

  const requestQuestion = useCallback(async (currentQuestion: AttributeQuestion | undefined, mode: 'pair' | 'a' | 'b' = 'pair') => {
    const catalog = await loadVotingCatalog();
    const collectionBggIds = collectionIdsRef.current;
    if (voteScopeRef.current === 'collection' && !collectionBggIds.length) {
      return {
        question: null,
        activities: [],
        extremeExamples: { lowest: [], highest: [] },
      } satisfies AttributeQuestionPayload;
    }
    const options = {
      ...questionOptions(currentQuestion, mode),
      excludedDirectRatingKeys: directRatingKeysRef.current,
    };
    const scopedSubjectIds = voteScopeRef.current === 'collection'
      ? getCollectionMatch(catalog, collectionBggIds).subjectIds
      : undefined;
    const { deferred, questionNumber } = await localDb.getAttributeQuestionContext();
    const subjectIds = availableAttributeSubjectIds(catalog, scopedSubjectIds, deferred, questionNumber);
    const selection = chooseScopedAttributeQuestion(catalog, subjectIds, options);
    if (!selection) {
      return {
        question: null,
        activities: [],
        extremeExamples: { lowest: [], highest: [] },
      } satisfies AttributeQuestionPayload;
    }
    const subjectA = catalog.subjects.find((subject) => subject.id === selection.subjectAId);
    const subjectB = catalog.subjects.find((subject) => subject.id === selection.subjectBId);
    const attribute = catalog.attributes.find((item) => item.id === selection.attributeId);
    if (!subjectA || !subjectB || !attribute) {
      return { question: null, activities: recentActivitiesRef.current } satisfies AttributeQuestionPayload;
    }
    const next: AttributeQuestionPayload = {
      question: {
        subjectA,
        subjectB,
        attribute,
        highPole: attribute.scaleType === 'bipolar' ? chooseAttributeHighPole(attribute, options.highPole) : undefined,
      },
      // Keep the last locally available feed; refreshing it is independent
      // from selecting and displaying the next question.
      activities: recentActivitiesRef.current,
      scoreModelVersion: catalog.scoreModelVersion,
    };
    await localDb.advanceAttributeQuestionNumber().catch(() => undefined);
    return {
      ...next,
      extremeExamples: chooseScopedExtremeExamples(catalog, selection.attributeId, scopedSubjectIds),
    };
  }, [getCollectionMatch, loadVotingCatalog]);

  const deferCurrentAndLoad = async (mode: 'pair' | 'a' | 'b') => {
    if (!question || questionLoading || submitting || awaitingNext) return;
    try {
      const catalog = votingCatalogRef.current ?? await loadVotingCatalog();
      const questionNumber = await localDb.getAttributeQuestionNumber();
      const subjects = mode === 'a' ? [question.subjectA] : mode === 'b' ? [question.subjectB] : [question.subjectA, question.subjectB];
      const questionDelay = mode === 'pair' ? 20 : 100;
      await Promise.all(subjects.map((subject) => {
        const catalogSubject = catalog.subjects.find((candidate) => candidate.id === subject.id);
        return localDb.deferAttributeSubject(subject.id, catalogSubject ? attributeSubjectBggIds(catalogSubject) : [], questionNumber, questionDelay);
      }));
    } catch {
      // A storage failure must not trap the user on the current question.
    }
    await loadQuestion(mode);
  };

  const loadQuestion = useCallback(async (mode: 'pair' | 'a' | 'b' = 'pair') => {
    setQuestionLoading(true);
    try {
      const next = await requestQuestion(question, mode);
      setConnectionState(browserIsOffline() ? 'offline' : 'online');
      await animateQuestionChange(next, mode);
    } catch {
      setConnectionState(connectionStateAfterFailure());
      setResponseError(browserIsOffline() ? '目前無法換下一題，請確認網路後再試。' : '目前無法連線到伺服器，請稍後再試。');
    } finally {
      setQuestionLoading(false);
    }
  }, [animateQuestionChange, question, requestQuestion]);

  const changeVoteScope = async (nextScope: AttributeVoteScope) => {
    if (nextScope === voteScopeRef.current || scopeLoading) return;
    if (nextScope === 'collection' && !collectionIdsRef.current.length) {
      setCollectionMessage('請先匯入收藏 CSV，才能使用我的收藏。');
      return;
    }
    const previousScope = voteScopeRef.current;
    voteScopeRef.current = nextScope;
    setVoteScope(nextScope);
    setScopeLoading(true);
    setQuestionLoading(true);
    setCollectionMessage('');
    try {
      if (nextScope === 'collection') await refreshCollectionScope();
      await localDb.setAttributeVoteScope(nextScope);
      const nextPayload = await requestQuestion(undefined, 'pair');
      setConnectionState(browserIsOffline() ? 'offline' : 'online');
      setError(false);
      await animateQuestionChange(nextPayload, 'pair');
    } catch {
      voteScopeRef.current = previousScope;
      setVoteScope(previousScope);
      await localDb.setAttributeVoteScope(previousScope).catch(() => undefined);
      setCollectionMessage('目前無法切換投票範圍，請稍後再試。');
    } finally {
      setScopeLoading(false);
      setQuestionLoading(false);
    }
  };

  const syncPendingResponses = useCallback(async () => {
    if (syncingRef.current || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const pending = (await refreshPendingCount()).filter((item) => !inFlightResponseIdsRef.current.has(item.responseId));
      for (const item of pending) {
        try {
          const saved = await api.saveAttributeResponse(item);
          await localDb.recordAttributeDirectRatings(sessionId, item, item.createdAt).catch(() => undefined);
          await localDb.updateAttributeCatalogValues(saved.updatedValues).catch(() => undefined);
          await localDb.removePendingAttributeResponse(item.id);
          setConnectionState(browserIsOffline() ? 'offline' : 'online');
        } catch (caught) {
          if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 409) {
            await localDb.removePendingAttributeResponse(item.id);
            attributeDirectRatingKeysFromResponse(item).forEach((key) => directRatingKeysRef.current.delete(key));
            setResponseError('有一筆離線回答已失效，請重新回答目前題目。');
            setConnectionState('online');
          } else if (caught instanceof ApiError && caught.status === 409) {
            setConnectionState('online');
          } else {
            setConnectionState(connectionStateAfterFailure());
          }
          break;
        }
      }
      const remaining = await refreshPendingCount();
      if (remaining.length < pending.length) {
        try {
          const next = await requestQuestion(question, 'pair');
          setConnectionState(browserIsOffline() ? 'offline' : 'online');
          applyQuestionPayload(next);
          // The question response may have raced the response write.  Mark
          // the cached question stale after applying it so the next page
          // opening re-reads the server feed instead of preserving an older
          // activity list indefinitely.
          void localDb.invalidateAttributeQuestion().catch(() => undefined);
        } catch {
          setConnectionState(connectionStateAfterFailure());
          setResponseError('回答已同步，但目前無法取得下一題，請按「重新取得下一題」。');
          setAwaitingNext(true);
        }
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [applyQuestionPayload, question, refreshPendingCount, requestQuestion, sessionId]);

  const persistResponse = useCallback(async (draft: AttributeResponseDraft) => {
    if (inFlightResponseIdsRef.current.has(draft.responseId)) return;
    inFlightResponseIdsRef.current.add(draft.responseId);
    const pendingItem: PendingAttributeResponse = {
      ...draft,
      id: draft.responseId,
      createdAt: Date.now(),
    };
    const directRatingKeys = attributeDirectRatingKeysFromResponse(pendingItem);
    directRatingKeys.forEach((key) => directRatingKeysRef.current.add(key));
    const queuePromise = localDb.addPendingAttributeResponse(pendingItem)
      .then(() => true)
      .catch(() => false);
    const savePromise = typeof navigator !== 'undefined' && !navigator.onLine
      ? Promise.reject(new TypeError('offline'))
      : api.saveAttributeResponse(draft);

    try {
      const [saved, queued] = await Promise.all([savePromise, queuePromise]);
      await localDb.recordAttributeDirectRatings(sessionId, pendingItem, pendingItem.createdAt).catch(() => undefined);
      if (votingCatalogRef.current) {
        votingCatalogRef.current = applyAttributeValueUpdates(votingCatalogRef.current, saved.updatedValues);
      }
      void localDb.updateAttributeCatalogValues(saved.updatedValues).catch(() => undefined);
      void Promise.all([
        localDb.clearDeferredAttributeSubject(draft.subjectAId),
        localDb.clearDeferredAttributeSubject(draft.subjectBId),
      ]).catch(() => undefined);
      if (queued) await localDb.removePendingAttributeResponse(pendingItem.id).catch(() => undefined);
      await refreshPendingCount();
      setConnectionState(browserIsOffline() ? 'offline' : 'online');
    } catch (caught) {
      const wasQueued = await queuePromise;
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 409) {
        if (wasQueued) await localDb.removePendingAttributeResponse(pendingItem.id).catch(() => undefined);
        directRatingKeys.forEach((key) => directRatingKeysRef.current.delete(key));
        setOptimisticActivities((current) => current.filter((activity) => activity.responseId !== draft.responseId));
        setConnectionState('online');
        setResponseError('上一筆回答已失效，請重新回答。');
      } else {
        const queued = wasQueued || await localDb.addPendingAttributeResponse(pendingItem).then(() => true).catch(() => false);
        setConnectionState(caught instanceof ApiError && caught.status === 409 ? 'online' : connectionStateAfterFailure());
        setResponseError(caught instanceof ApiError && caught.status === 409
          ? '上一筆回答正在處理，會自動重試。'
          : queued
            ? (browserIsOffline() ? '目前離線，回答已暫存在本機；恢復連線後會自動同步。' : '回答已在背景暫存，稍後會自動同步。')
            : '目前無法送出或暫存回答，請確認網路後再試。');
      }
      await refreshPendingCount();
    } finally {
      inFlightResponseIdsRef.current.delete(draft.responseId);
      if (typeof navigator === 'undefined' || navigator.onLine) void syncPendingResponses();
    }
  }, [refreshPendingCount, sessionId, syncPendingResponses]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [pending, storedScope, importedIds, storedDirectRatingKeys] = await Promise.all([
        refreshPendingCount(),
        localDb.getAttributeVoteScope().catch(() => 'all' as AttributeVoteScope),
        localDb.getAttributeCollectionIds().catch(() => [] as number[]),
        localDb.getAttributeDirectRatingKeys(sessionId).catch(() => [] as string[]),
      ]);
      directRatingKeysRef.current = new Set([
        ...storedDirectRatingKeys,
        ...pending.filter((item) => item.sessionId === sessionId).flatMap(attributeDirectRatingKeysFromResponse),
      ]);
      const effectiveScope = storedScope === 'collection' && importedIds.length ? storedScope : 'all';
      voteScopeRef.current = effectiveScope;
      collectionIdsRef.current = importedIds;
      if (active) {
        setVoteScope(effectiveScope);
        setCollectionIds(importedIds);
        setCollectionMatchKnown(false);
      }
      const cached = await localDb.getLatestAttributeQuestion().catch(() => undefined);
      const cachedQuestion = cached?.data.question;
      const cachedHasDirectRating = Boolean(cachedQuestion && (
        directRatingKeysRef.current.has(attributeDirectRatingKey(cachedQuestion.subjectA.id, cachedQuestion.attribute.id))
        || directRatingKeysRef.current.has(attributeDirectRatingKey(cachedQuestion.subjectB.id, cachedQuestion.attribute.id))
      ));
      const cachedMatchesScope = cached?.data.question
        && !cachedHasDirectRating
        && (cached.scope ? cached.scope === effectiveScope : effectiveScope === 'all');
      if (cachedMatchesScope && active) {
        applyQuestionPayload(cached.data);
        // A cached question is immediately usable. The network call below is
        // revalidation and must not keep the whole page in its loading state.
        setLoading(false);
        if (Date.now() - cached.cachedAt < ATTRIBUTE_QUESTION_CACHE_FRESH_MS) {
          // Re-opening the page shortly after leaving it should resume the
          // unanswered question instead of issuing another expensive random
          // selection request. Voting or an explicit "不知道" still obtains
          // a fresh question through the normal path.
          if (pending.length && (typeof navigator === 'undefined' || navigator.onLine)) void syncPendingResponses();
          return;
        }
      }
      try {
        const nextPayload = await requestQuestion(undefined);
        if (!active) return;
        setConnectionState(browserIsOffline() ? 'offline' : 'online');
        setError(false);
        applyQuestionPayload(nextPayload);
      } catch {
        if (active) setConnectionState(connectionStateAfterFailure());
        if (active && !cachedMatchesScope) setError(true);
        if (active && cachedMatchesScope) {
          setResponseError(browserIsOffline()
            ? '目前離線，顯示上次取得的題目；恢復連線後會自動同步。'
            : '目前暫時無法連線到伺服器，先顯示上次取得的題目。');
        }
      } finally {
        if (active) setLoading(false);
      }
      if (active && pending.length && (typeof navigator === 'undefined' || navigator.onLine)) void syncPendingResponses();
    })();
    return () => { active = false; };
  // This is intentionally a mount/load effect. The pending sync callback is
  // invoked after the first network result and on the browser online event.
  }, [applyQuestionPayload, refreshPendingCount, requestQuestion, sessionId]);

  useEffect(() => {
    const handleOnline = () => {
      setConnectionState((current) => current === 'offline' ? 'online' : current);
      void syncPendingResponses();
    };
    const handleOffline = () => setConnectionState('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncPendingResponses]);

  const submitResponse = async (selectedComparison: AttributeComparisonResult | null = comparison) => {
    if (!question) return;
    const parsedRatingA = ratingA === '' ? null : Number(ratingA);
    const parsedRatingB = ratingB === '' ? null : Number(ratingB);
    if (selectedComparison == null && parsedRatingA == null && parsedRatingB == null) {
      setResponseError('請至少選一個比較結果或填一個分數。');
      return;
    }
    if (awaitingNext) return;
    setSubmitting(true);
    setResponseError('');
    const responseId = responseIdRef.current ?? createAttributeResponseId();
    responseIdRef.current = responseId;
    const draft: AttributeResponseDraft = {
      highPole: question.highPole,
      subjectAId: question.subjectA.id,
      subjectBId: question.subjectB.id,
      attributeId: question.attribute.id,
      responseId,
      comparison: selectedComparison,
      ratingA: parsedRatingA,
      ratingB: parsedRatingB,
      sessionId,
    } satisfies Omit<PendingAttributeResponse, 'id' | 'createdAt'>;
    const optimisticActivity = optimisticComparisonActivity(question, draft, optimisticActorName);
    if (optimisticActivity) {
      setOptimisticActivities((current) => [
        optimisticActivity,
        ...current.filter((activity) => activity.responseId !== optimisticActivity.responseId),
      ].slice(0, OPTIMISTIC_ACTIVITY_LIMIT));
    }
    // The network write and the next-question request intentionally run in
    // parallel. The response is durably queued in IndexedDB by persistResponse
    // before its background promise is allowed to finish.
    const persistencePromise = persistResponse(draft);
    responseIdRef.current = undefined;
    setAwaitingNext(false);
    if (selectedComparison) setVoteFeedback({ state: 'saved', text: `已記錄：${comparisonChoiceText(question, selectedComparison)}` });
    try {
      const [nextPayload] = await Promise.all([
        requestQuestion(question, 'pair'),
        reducedMotion() ? Promise.resolve() : wait(SAVED_FEEDBACK_MS),
      ]);
      setConnectionState(browserIsOffline() ? 'offline' : 'online');
      await animateQuestionChange(nextPayload, 'pair');
    } catch {
      if (!mountedRef.current) return;
      setConnectionState(connectionStateAfterFailure());
      setVoteFeedback(null);
      setQuestionMotion('idle');
      setAwaitingNext(true);
      clearResponse();
       setResponseError('回答正在背景儲存，但目前無法取得下一題；請按「重新取得下一題」。');
    } finally {
      // Persisting the answer and obtaining the next question run in
      // parallel.  Invalidate only after both have settled, avoiding a race
      // where a fast POST invalidates the cache and the slower GET then
      // writes the stale activity list back as fresh.
      void persistencePromise.then(() => localDb.invalidateAttributeQuestion()).catch(() => undefined);
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const chooseComparison = (result: AttributeComparisonResult) => {
    setComparison(result);
    if (question) {
      setComparisonQuestionKey(attributeQuestionKey(question));
      setVoteFeedback({ state: 'saving', text: `記錄中：${comparisonChoiceText(question, result)}` });
      setQuestionMotion('answering');
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(12);
    }
    void submitResponse(result);
  };

  const { handleCollectionImport } = useAttributeCollectionImport({ setCollectionImporting, setCollectionMessage, collectionIdsRef, setCollectionIds, setCollectionMatchKnown, loadVotingCatalog, setCollectionMatchCount, voteScopeRef, requestQuestion, question, setConnectionState, animateQuestionChange, applyQuestionPayload, setResponseError });

  return {
    collectionImporting,
    collectionInputRef,
    handleCollectionImport,
    collectionIds,
    collectionMatchKnown,
    collectionMatchCount,
    voteScope,
    changeVoteScope,
    scopeLoading,
    loading,
    error,
    payload,
    question,
    collectionMessage,
    optimisticActivities,
    comparisonQuestionKey,
    ratingA,
    ratingB,
    connectionState,
    pendingCount,
    syncPendingResponses,
    loadQuestion,
    syncing,
    questionLoading,
    questionMotion,
    submitting,
    comparison,
    chooseComparison,
    awaitingNext,
    voteFeedback,
    deferCurrentAndLoad,
    setRatingA,
    setRatingB,
    responseError,
  };
};

export type AttributesPageViewModel = ReturnType<typeof useAttributesPage>;
