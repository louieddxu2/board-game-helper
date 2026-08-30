import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AttributeGameCard } from '../components/AttributeGameCard';
import { AttributeRatingTrack } from '../components/AttributeRatingTrack';
import { AttributeScoreAxis } from '../components/AttributeScoreAxis';
import { useClampedAxisMarker } from '../components/useClampedAxisMarker';
import { ApiError, api } from '../lib/api';
import { attributeComparisonWording, attributeQuestionEnding } from '../lib/attributeQuestion';
import { suggestedComparisonForRatings } from '../lib/attributeRatingSuggestion';
import { createAttributeResponseId, getAttributeSessionId } from '../lib/attributeSession';
import { attributeSubjectBggIds, availableAttributeSubjectIds, chooseScopedAttributeQuestion, chooseScopedExtremeExamples, matchCollectionSubjects, parseGeekGroupCollectionCsv, type ScopedAttributeQuestionOptions } from '../lib/attributeCollection';
import { applyAttributeValueUpdates, localDb, type PendingAttributeResponse } from '../lib/localDb';
import type { AttributeActivity, AttributeComparisonResult, AttributeQuestion, AttributeQuestionPayload, AttributeScoreExample } from '../shared/types';

type QuestionMotion = 'idle' | 'answering' | 'leaving' | 'entering' | 'leaving-a' | 'entering-a' | 'leaving-b' | 'entering-b';
type VoteFeedback = { state: 'saving' | 'saved'; text: string } | null;
type AttributeVoteScope = 'all' | 'collection';
type ConnectionState = 'online' | 'offline' | 'server-unavailable';

const QUESTION_EXIT_MS = 150;
const QUESTION_ENTER_MS = 260;
const SAVED_FEEDBACK_MS = 360;
const ATTRIBUTE_QUESTION_CACHE_FRESH_MS = 5 * 60 * 1000;
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const browserIsOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;
const connectionStateAfterFailure = (): ConnectionState => browserIsOffline() ? 'offline' : 'server-unavailable';

const subjectName = (subject: { displayName: string }) => <span>{subject.displayName}</span>;

const activitySubject = (subject: { displayName: string }, rating?: number) => <>{subjectName(subject)}{rating != null ? `（${rating}）` : null}</>;

const activityText = (activity: AttributeActivity) => {
  if (activity.subjectA && activity.subjectB && activity.result) {
    const attributeKey = activity.attributeId.replace(/^attribute[-_]/, '');
    const wording = attributeComparisonWording(attributeKey);
    if (activity.result === 'A_HIGHER') return <>{activity.actorName} 認為 {activitySubject(activity.subjectA, activity.ratingA)} 的「{activity.attributeName}」比 {activitySubject(activity.subjectB, activity.ratingB)} {wording.higher}</>;
    if (activity.result === 'B_HIGHER') return <>{activity.actorName} 認為 {activitySubject(activity.subjectB, activity.ratingB)} 的「{activity.attributeName}」比 {activitySubject(activity.subjectA, activity.ratingA)} {wording.higher}</>;
    return <>{activity.actorName} 認為 {activitySubject(activity.subjectA, activity.ratingA)} 與 {activitySubject(activity.subjectB, activity.ratingB)} 的「{activity.attributeName}」{wording.similar}</>;
  }
  return `${activity.actorName} 完成了一筆屬性投票`;
};

const ExtremeScoreMarker = ({ example, direction, row }: { example: AttributeScoreExample; direction: 'low' | 'high'; row: 'lower' | 'upper' }) => {
  const markerRef = useClampedAxisMarker<HTMLSpanElement>(example.score, `${example.subject.id}:${example.subject.displayName}:${example.score}`);
  return <span
    ref={markerRef}
    className={`attributes-scoreline-marker is-${direction} is-${row}`}
    style={{ left: `${example.score * 10}%` }}
    title={`${example.score} 分：${example.subject.displayName}`}
  >
    <span className="attributes-scoreline-marker-label">{subjectName(example.subject)}</span>
  </span>;
};

const questionOptions = (question: AttributeQuestion | undefined, mode: 'pair' | 'a' | 'b'): ScopedAttributeQuestionOptions => {
  if (!question) return {};
  const base = {
    excludeSubjectAId: question.subjectA.id,
    excludeSubjectBId: question.subjectB.id,
    excludeAttributeId: question.attribute.id,
  };
  if (mode === 'a') return { ...base, fixedSubjectBId: question.subjectB.id, fixedAttributeId: question.attribute.id };
  if (mode === 'b') return { ...base, fixedSubjectAId: question.subjectA.id, fixedAttributeId: question.attribute.id };
  return base;
};

const comparisonChoiceText = (question: AttributeQuestion, result: AttributeComparisonResult) => {
  if (result === 'A_HIGHER') return `${question.subjectA.displayName}較高`;
  if (result === 'B_HIGHER') return `${question.subjectB.displayName}較高`;
  return '兩款差不多';
};

export const AttributesPage = () => {
  const [payload, setPayload] = useState<AttributeQuestionPayload>();
  const [question, setQuestion] = useState<AttributeQuestion>();
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
  const collectionIdsRef = useRef<number[]>([]);
  const votingCatalogRef = useRef<Awaited<ReturnType<typeof api.attributeTable>> | undefined>(undefined);
  const voteScopeRef = useRef<AttributeVoteScope>('all');
  const collectionInputRef = useRef<HTMLInputElement>(null);
  const responseIdRef = useRef<string | undefined>(undefined);
  const syncingRef = useRef(false);
  const motionTimerRef = useRef<number | undefined>(undefined);

  const clearResponse = () => {
    setComparison(null);
    setRatingA('');
    setRatingB('');
    setResponseError('');
  };

  const applyQuestionPayload = useCallback((nextPayload: AttributeQuestionPayload, scope: AttributeVoteScope = voteScopeRef.current) => {
    setPayload(nextPayload);
    setQuestion(nextPayload.question ?? undefined);
    responseIdRef.current = undefined;
    setAwaitingNext(false);
    clearResponse();
    void localDb.cacheAttributeQuestion(nextPayload, scope).catch(() => undefined);
  }, []);

  const animateQuestionChange = useCallback(async (nextPayload: AttributeQuestionPayload, mode: 'pair' | 'a' | 'b' = 'pair') => {
    if (motionTimerRef.current !== undefined) window.clearTimeout(motionTimerRef.current);
    const noMotion = reducedMotion();
    setQuestionMotion(mode === 'pair' ? 'leaving' : mode === 'a' ? 'leaving-a' : 'leaving-b');
    if (!noMotion) await wait(QUESTION_EXIT_MS);
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

  useEffect(() => () => {
    if (motionTimerRef.current !== undefined) window.clearTimeout(motionTimerRef.current);
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
        setCollectionMatchCount(matchCollectionSubjects(updated, ids).matchedBggIds.length);
        setCollectionMatchKnown(true);
      }
    });
    votingCatalogRef.current = catalog;
    return catalog;
  }, []);

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
    setCollectionMatchCount(matchCollectionSubjects(catalog, ids).matchedBggIds.length);
    setCollectionMatchKnown(true);
  }, [loadVotingCatalog]);

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
    const options = questionOptions(currentQuestion, mode);
    const scopedSubjectIds = voteScopeRef.current === 'collection'
      ? matchCollectionSubjects(catalog, collectionBggIds).subjectIds
      : undefined;
    const [deferred, questionNumber] = await Promise.all([
      localDb.getDeferredAttributeSubjects(),
      localDb.getAttributeQuestionNumber(),
    ]);
    const subjectIds = availableAttributeSubjectIds(catalog, scopedSubjectIds, deferred, questionNumber);
    const selection = chooseScopedAttributeQuestion(catalog, subjectIds, options);
    if (!selection) {
      return {
        question: null,
        activities: [],
        extremeExamples: { lowest: [], highest: [] },
      } satisfies AttributeQuestionPayload;
    }
    const next = await api.attributeQuestion(sessionId, {
      fixedSubjectAId: selection.subjectAId,
      fixedSubjectBId: selection.subjectBId,
      fixedAttributeId: selection.attributeId,
      includeExtremeExamples: false,
    });
    await localDb.advanceAttributeQuestionNumber().catch(() => undefined);
    return {
      ...next,
      extremeExamples: chooseScopedExtremeExamples(catalog, selection.attributeId, scopedSubjectIds),
    };
  }, [loadVotingCatalog, sessionId]);

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
      const pending = await refreshPendingCount();
      for (const item of pending) {
        try {
          const saved = await api.saveAttributeResponse(item);
          await localDb.updateAttributeCatalogValues(saved.updatedValues).catch(() => undefined);
          await localDb.removePendingAttributeResponse(item.id);
          setConnectionState(browserIsOffline() ? 'offline' : 'online');
        } catch (caught) {
          if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 409) {
            await localDb.removePendingAttributeResponse(item.id);
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

  useEffect(() => {
    let active = true;
    void (async () => {
      const [pending, storedScope, importedIds] = await Promise.all([
        refreshPendingCount(),
        localDb.getAttributeVoteScope().catch(() => 'all' as AttributeVoteScope),
        localDb.getAttributeCollectionIds().catch(() => [] as number[]),
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
      const cachedMatchesScope = cached?.data.question
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
        if (active && !cached?.data.question) setError(true);
        if (active && cached?.data.question) {
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
    if (!payload?.questionToken) {
      setResponseError('這一題已經過期，請重新取得題目。');
      return;
    }
    if (awaitingNext) return;
    setSubmitting(true);
    setResponseError('');
    const responseId = responseIdRef.current ?? createAttributeResponseId();
    responseIdRef.current = responseId;
    const draft = {
      subjectAId: question.subjectA.id,
      subjectBId: question.subjectB.id,
      attributeId: question.attribute.id,
      questionToken: payload.questionToken,
      responseId,
      comparison: selectedComparison,
      ratingA: parsedRatingA,
      ratingB: parsedRatingB,
      sessionId,
    } satisfies Omit<PendingAttributeResponse, 'id' | 'createdAt'>;
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new TypeError('offline');
      const saved = await api.saveAttributeResponse(draft);
      if (votingCatalogRef.current) {
        votingCatalogRef.current = applyAttributeValueUpdates(votingCatalogRef.current, saved.updatedValues);
      }
      // Persisting the denormalized ~1.7 MB catalog is not part of the voting
      // critical path. The in-memory catalog above is already current for the
      // next local selection; IndexedDB catches up in the background.
      void localDb.updateAttributeCatalogValues(saved.updatedValues).catch(() => undefined);
      await Promise.all([
        localDb.clearDeferredAttributeSubject(question.subjectA.id),
        localDb.clearDeferredAttributeSubject(question.subjectB.id),
      ]).catch(() => undefined);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        setConnectionState('online');
        setVoteFeedback(null);
        setQuestionMotion('idle');
        setResponseError(caught.status === 409 ? '這題剛被回答，請重新作答。' : '這一題已經失效，請重新取得題目。');
        if (caught.status !== 409) void loadQuestion('pair');
        setSubmitting(false);
        return;
      }
      try {
        await localDb.addPendingAttributeResponse(draft);
        setConnectionState(connectionStateAfterFailure());
        await refreshPendingCount();
        setAwaitingNext(true);
        setVoteFeedback(selectedComparison ? { state: 'saved', text: `已暫存：${comparisonChoiceText(question, selectedComparison)}` } : null);
        setQuestionMotion('idle');
        clearResponse();
        setResponseError(browserIsOffline()
          ? '目前離線，回答已暫存在本機；恢復連線後會自動同步。'
          : '目前暫時無法連線到伺服器，回答已暫存在本機；稍後會自動同步。');
      } catch {
        setVoteFeedback(null);
        setQuestionMotion('idle');
        setResponseError('目前無法送出或暫存回答，請確認網路後再試。');
      }
      setSubmitting(false);
      return;
    }
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
      setConnectionState(connectionStateAfterFailure());
      setVoteFeedback(null);
      setQuestionMotion('idle');
      setAwaitingNext(true);
      clearResponse();
      setResponseError('回答已儲存，但目前無法取得下一題；請按「重新取得下一題」。');
    } finally {
      setSubmitting(false);
    }
  };

  const chooseComparison = (result: AttributeComparisonResult) => {
    setComparison(result);
    if (question) {
      setVoteFeedback({ state: 'saving', text: `記錄中：${comparisonChoiceText(question, result)}` });
      setQuestionMotion('answering');
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(12);
    }
    void submitResponse(result);
  };

  const handleCollectionImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCollectionImporting(true);
    setCollectionMessage('');
    try {
      const parsed = parseGeekGroupCollectionCsv(await file.text());
      await localDb.replaceAttributeCollectionIds(parsed.bggIds);
      collectionIdsRef.current = parsed.bggIds;
      setCollectionIds(parsed.bggIds);
      setCollectionMatchKnown(false);
      const catalog = await loadVotingCatalog();
      const match = matchCollectionSubjects(catalog, parsed.bggIds);
      setCollectionMatchCount(match.matchedBggIds.length);
      setCollectionMatchKnown(true);
      setCollectionMessage(`已匯入 ${parsed.bggIds.length} 款，找到 ${match.matchedBggIds.length} 款可投票遊戲。`);
      if (voteScopeRef.current !== 'collection') return;
      const next = await requestQuestion(question, 'pair');
      if (next.question) {
        setConnectionState(browserIsOffline() ? 'offline' : 'online');
        await animateQuestionChange(next, 'pair');
      } else {
        applyQuestionPayload(next);
        setResponseError('這份收藏中目前找不到至少兩款可投票的遊戲。');
      }
    } catch (caught) {
      const message = caught instanceof Error && caught.message === 'csv_game_id_column_missing'
        ? 'CSV 中找不到 Game ID 欄位。'
        : caught instanceof Error && caught.message === 'csv_no_game_ids'
          ? 'CSV 中沒有可辨識的 Game ID。'
        : caught instanceof Error && caught.message === 'csv_file_too_large'
          ? 'CSV 檔案不可超過 5 MB。'
          : 'CSV 匯入失敗，請確認這是 GeekGroup 收藏匯出檔。';
      setCollectionMessage(message);
    } finally {
      setCollectionImporting(false);
    }
  };

  const collectionImportControl = <label className="attributes-collection-import">
    <span>{collectionImporting ? '讀取中…' : '匯入收藏'}</span>
    <input ref={collectionInputRef} type="file" accept=".csv,text/csv" onChange={(event) => void handleCollectionImport(event)} disabled={collectionImporting} />
  </label>;

  const collectionScopeLabel = !collectionIds.length
    ? '我的收藏'
    : collectionMatchKnown ? `我的收藏 ${collectionMatchCount}/${collectionIds.length}` : `我的收藏 (${collectionIds.length})`;
  const voteScopeControl = <div className="attributes-vote-scope" role="group" aria-label="投票範圍">
    <span className="attributes-vote-scope-label">投票範圍</span>
    <button type="button" className={voteScope === 'all' ? 'is-active' : undefined} aria-pressed={voteScope === 'all'} onClick={() => void changeVoteScope('all')} disabled={scopeLoading || voteScope === 'all'}>全部遊戲</button>
    <button type="button" className={voteScope === 'collection' ? 'is-active' : undefined} aria-pressed={voteScope === 'collection'} onClick={() => void changeVoteScope('collection')} disabled={scopeLoading || voteScope === 'collection' || !collectionIds.length} title={collectionIds.length ? '只從匯入收藏中有屬性資料的遊戲出題' : '請先匯入收藏 CSV'}>{scopeLoading ? '切換中…' : collectionScopeLabel}</button>
  </div>;

  if (loading) return <section className="attribute-vote-page"><p>載入中…</p></section>;
  if (error || !payload || !question) return <section className="attribute-vote-page attributes-no-question">
    <header className="attribute-vote-header"><h1>屬性投票</h1><div className="attributes-vote-actions">{collectionImportControl}<Link className="attributes-table-link" to="/attributes/table">屬性總表</Link></div></header>
    {voteScopeControl}
    <p>{voteScope === 'collection' && collectionIds.length ? `我的收藏中只有 ${collectionMatchCount} 款遊戲可用，至少需要兩款。` : '目前無法取得題目。'}</p>
    {collectionMessage && <p className="attributes-collection-message" role="status">{collectionMessage}</p>}
    <button type="button" className="button primary" onClick={() => window.location.reload()}>重新載入</button>
  </section>;

  const lowestExamples = [...(payload.extremeExamples?.lowest ?? [])]
    .filter((example) => example.score <= 2)
    .sort((left, right) => left.score - right.score)
    .slice(0, 2);
  const highestExamples = [...(payload.extremeExamples?.highest ?? [])]
    .filter((example) => example.score >= 8)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);
  const attributeDescription = question.attribute.shortDescription ?? question.attribute.fullDescription;
  const questionEnding = attributeQuestionEnding(question.attribute.key);
  const recentComparisons = payload.activities.filter((activity) => activity.kind === 'comparison').slice(0, 5);
  const ratingSuggestion = suggestedComparisonForRatings(ratingA, ratingB);
  const ratingSuggestionText = ratingSuggestion === 'A_HIGHER'
    ? `依照分數，建議點「${question.subjectA.displayName}」`
    : ratingSuggestion === 'B_HIGHER'
      ? `依照分數，建議點「${question.subjectB.displayName}」`
      : ratingSuggestion === 'SIMILAR' ? '依照分數，建議選「差不多」' : '';

  return <section className="attribute-vote-page">
    <header className="attribute-vote-header">
      <h1>屬性投票</h1>
      <div className="attributes-vote-actions">
        {collectionImportControl}
        <Link className="attributes-table-link" to="/attributes/table">屬性總表</Link>
      </div>
    </header>
    {voteScopeControl}
    {collectionMessage && <p className="attributes-collection-message" role="status">{collectionMessage}</p>}
    <div className="attributes-inline-activity" aria-label="最近投票記錄">
      {recentComparisons.length ? <ol>{recentComparisons.map((activity) => <li key={activity.id}><span className="attributes-inline-activity-icon" aria-hidden="true">比</span><span>{activityText(activity)}</span></li>)}</ol> : <span className="attributes-inline-activity-empty">尚無近期紀錄</span>}
    </div>

    {(connectionState !== 'online' || pendingCount > 0) && <p className="attributes-offline-note" role="status">
      {pendingCount > 0
        ? `有 ${pendingCount} 筆回答等待同步。`
        : connectionState === 'offline'
          ? '目前離線，回答會先暫存在本機。'
          : '目前暫時無法連線到伺服器，回答會先暫存在本機。'}
      <button
        type="button"
        onClick={() => pendingCount > 0 ? void syncPendingResponses() : void loadQuestion('pair')}
        disabled={syncing || questionLoading}
      >
        {syncing ? '同步中…' : pendingCount > 0 ? '重新同步' : '重試連線'}
      </button>
    </p>}

    <section className={`attributes-question-card is-${questionMotion}`} aria-labelledby="attributes-question-heading" aria-busy={questionLoading || submitting}>
      <div className="attributes-question-center">
        {(lowestExamples.length || highestExamples.length) ? <div className="attributes-question-examples">
          <AttributeScoreAxis ariaLabel="目前資料中的極端分數範例" className="attributes-scoreline-track">
            {lowestExamples.map((example, index) => <ExtremeScoreMarker example={example} direction="low" row={index === 0 ? 'lower' : 'upper'} key={`low:${example.subject.id}`} />)}
            {highestExamples.map((example, index) => <ExtremeScoreMarker example={example} direction="high" row={index === 0 ? 'lower' : 'upper'} key={`high:${example.subject.id}`} />)}
          </AttributeScoreAxis>
        </div> : null}
        <div className="attributes-question-attribute">
          <h2 id="attributes-question-heading" aria-live="polite">哪款遊戲的<span className="attributes-question-term"><strong>「{question.attribute.name}」</strong>{(lowestExamples.length || highestExamples.length) ? <span className="attributes-example-cue" aria-hidden="true">↑ 範例</span> : null}</span>{questionEnding}？</h2>
          {attributeDescription && <p className="attributes-question-description">{attributeDescription}</p>}
        </div>
        <div className="attributes-question-pair">
          <div className="attributes-question-side">
            <AttributeGameCard key={question.subjectA.id} subject={question.subjectA} side="left" selected={comparison === 'A_HIGHER'} suggested={!submitting && ratingSuggestion === 'A_HIGHER'} onChoose={() => chooseComparison('A_HIGHER')} disabled={questionLoading || submitting || awaitingNext} />
          </div>
          <div className="attributes-question-side">
            <AttributeGameCard key={question.subjectB.id} subject={question.subjectB} side="right" selected={comparison === 'B_HIGHER'} suggested={!submitting && ratingSuggestion === 'B_HIGHER'} onChoose={() => chooseComparison('B_HIGHER')} disabled={questionLoading || submitting || awaitingNext} />
          </div>
          {voteFeedback && <p className={`attributes-vote-feedback is-${voteFeedback.state}`} role="status" aria-live="polite"><span aria-hidden="true">{voteFeedback.state === 'saved' ? '✓' : '…'}</span>{voteFeedback.text}</p>}
        </div>

        <div className="attributes-pair-actions" aria-label="回答與換題">
          <button type="button" className="attributes-change-one is-left" aria-label={`換掉${question.subjectA.displayName}`} onClick={() => void deferCurrentAndLoad('a')} disabled={questionLoading || submitting || awaitingNext}><span aria-hidden="true">↻</span> 換一個</button>
          <button type="button" className={`attributes-similar ${comparison === 'SIMILAR' ? 'is-selected' : ''} ${!submitting && ratingSuggestion === 'SIMILAR' ? 'is-suggested' : ''}`} aria-pressed={comparison === 'SIMILAR'} onClick={() => chooseComparison('SIMILAR')} disabled={questionLoading || submitting || awaitingNext}><span aria-hidden="true">≈</span> 差不多</button>
          <button type="button" className="attributes-change-one is-right" aria-label={`換掉${question.subjectB.displayName}`} onClick={() => void deferCurrentAndLoad('b')} disabled={questionLoading || submitting || awaitingNext}>換一個 <span aria-hidden="true">↻</span></button>
          <button type="button" className="attributes-unknown" aria-label="不知道，換一組" onClick={() => void deferCurrentAndLoad('pair')} disabled={questionLoading || submitting || awaitingNext}>不知道</button>
        </div>
        <div className="attributes-rating-zone">
          <AttributeRatingTrack leftSubject={question.subjectA} rightSubject={question.subjectB} leftValue={ratingA} rightValue={ratingB} onLeftChange={setRatingA} onRightChange={setRatingB} onLeftClear={() => setRatingA('')} onRightClear={() => setRatingB('')} disabled={questionLoading || submitting || awaitingNext} />
          {ratingSuggestionText && !submitting && <p className="attributes-rating-suggestion" role="status"><span aria-hidden="true">↑</span> {ratingSuggestionText}</p>}
          {responseError && <p className="attributes-response-error" role="alert">{responseError} {awaitingNext && <button type="button" onClick={() => void loadQuestion('pair')} disabled={questionLoading || submitting}>重新取得下一題</button>}</p>}
        </div>
      </div>
    </section>

  </section>;
};
