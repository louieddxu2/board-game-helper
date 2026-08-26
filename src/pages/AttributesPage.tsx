import { useCallback, useEffect, useRef, useState } from 'react';
import { AttributeGameCard } from '../components/AttributeGameCard';
import { AttributeRatingTrack } from '../components/AttributeRatingTrack';
import { AttributeScoreAxis } from '../components/AttributeScoreAxis';
import { useClampedAxisMarker } from '../components/useClampedAxisMarker';
import { ApiError, api } from '../lib/api';
import { attributeQuestionEnding } from '../lib/attributeQuestion';
import { suggestedComparisonForRatings } from '../lib/attributeRatingSuggestion';
import { createAttributeResponseId, getAttributeSessionId } from '../lib/attributeSession';
import { localDb, type PendingAttributeResponse } from '../lib/localDb';
import type { AttributeActivity, AttributeComparisonResult, AttributeQuestion, AttributeQuestionPayload, AttributeScoreExample } from '../shared/types';

type QuestionMotion = 'idle' | 'answering' | 'leaving' | 'entering' | 'leaving-a' | 'entering-a' | 'leaving-b' | 'entering-b';
type VoteFeedback = { state: 'saving' | 'saved'; text: string } | null;

const QUESTION_EXIT_MS = 150;
const QUESTION_ENTER_MS = 260;
const SAVED_FEEDBACK_MS = 360;
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const subjectName = (subject: { displayName: string }) => <span>{subject.displayName}</span>;

const activitySubject = (subject: { displayName: string }, rating?: number) => <>{subjectName(subject)}{rating != null ? `（${rating}）` : null}</>;

const activityText = (activity: AttributeActivity) => {
  if (activity.subjectA && activity.subjectB && activity.result) {
    if (activity.result === 'A_HIGHER') return <>{activity.actorName} 認為 {activitySubject(activity.subjectA, activity.ratingA)} 的「{activity.attributeName}」高於 {activitySubject(activity.subjectB, activity.ratingB)}</>;
    if (activity.result === 'B_HIGHER') return <>{activity.actorName} 認為 {activitySubject(activity.subjectB, activity.ratingB)} 的「{activity.attributeName}」高於 {activitySubject(activity.subjectA, activity.ratingA)}</>;
    return <>{activity.actorName} 認為 {activitySubject(activity.subjectA, activity.ratingA)} 與 {activitySubject(activity.subjectB, activity.ratingB)} 的「{activity.attributeName}」差不多</>;
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

const questionOptions = (question: AttributeQuestion | undefined, mode: 'pair' | 'a' | 'b') => {
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
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [comparison, setComparison] = useState<AttributeComparisonResult | null>(null);
  const [ratingA, setRatingA] = useState('');
  const [ratingB, setRatingB] = useState('');
  const [questionMotion, setQuestionMotion] = useState<QuestionMotion>('idle');
  const [voteFeedback, setVoteFeedback] = useState<VoteFeedback>(null);
  const [sessionId] = useState(getAttributeSessionId);
  const responseIdRef = useRef<string | undefined>(undefined);
  const syncingRef = useRef(false);
  const motionTimerRef = useRef<number | undefined>(undefined);

  const clearResponse = () => {
    setComparison(null);
    setRatingA('');
    setRatingB('');
    setResponseError('');
  };

  const applyQuestionPayload = useCallback((nextPayload: AttributeQuestionPayload) => {
    setPayload(nextPayload);
    setQuestion(nextPayload.question ?? undefined);
    responseIdRef.current = undefined;
    setAwaitingNext(false);
    clearResponse();
    void localDb.cacheAttributeQuestion(nextPayload).catch(() => undefined);
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

  const loadQuestion = useCallback(async (mode: 'pair' | 'a' | 'b' = 'pair') => {
    setQuestionLoading(true);
    try {
      const next = await api.attributeQuestion(sessionId, questionOptions(question, mode));
      setOffline(false);
      await animateQuestionChange(next, mode);
    } catch {
      setResponseError('目前無法換下一題，請稍後再試。');
    } finally {
      setQuestionLoading(false);
    }
  }, [animateQuestionChange, question, sessionId]);

  const syncPendingResponses = useCallback(async () => {
    if (syncingRef.current || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const pending = await refreshPendingCount();
      for (const item of pending) {
        try {
          await api.saveAttributeResponse(item);
          await localDb.removePendingAttributeResponse(item.id);
        } catch (caught) {
          if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 409) {
            await localDb.removePendingAttributeResponse(item.id);
            setResponseError('有一筆離線回答已失效，請重新回答目前題目。');
          }
          break;
        }
      }
      const remaining = await refreshPendingCount();
      if (remaining.length < pending.length) {
        try {
          const next = await api.attributeQuestion(sessionId, questionOptions(question, 'pair'));
          setOffline(false);
          applyQuestionPayload(next);
        } catch {
          setResponseError('回答已同步，但目前無法取得下一題，請按「重新取得下一題」。');
          setAwaitingNext(true);
        }
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [applyQuestionPayload, question, refreshPendingCount, sessionId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const pending = await refreshPendingCount();
      const cached = await localDb.getLatestAttributeQuestion().catch(() => undefined);
      if (cached && active) {
        applyQuestionPayload(cached.data);
        setOffline(true);
      }
      try {
        const nextPayload = await api.attributeQuestion(sessionId);
        if (!active) return;
        setOffline(false);
        setError(false);
        applyQuestionPayload(nextPayload);
      } catch {
        if (active && !cached?.data.question) setError(true);
        if (active && cached?.data.question) setResponseError('目前離線，顯示上次取得的題目；恢復連線後會自動同步。');
      } finally {
        if (active) setLoading(false);
      }
      if (active && pending.length && (typeof navigator === 'undefined' || navigator.onLine)) void syncPendingResponses();
    })();
    return () => { active = false; };
  // This is intentionally a mount/load effect. The pending sync callback is
  // invoked after the first network result and on the browser online event.
  }, [applyQuestionPayload, refreshPendingCount, sessionId]);

  useEffect(() => {
    const handleOnline = () => {
      setOffline(false);
      void syncPendingResponses();
    };
    const handleOffline = () => setOffline(true);
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
      await api.saveAttributeResponse(draft);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        setVoteFeedback(null);
        setQuestionMotion('idle');
        setResponseError(caught.status === 409 ? '這題剛被回答，請重新作答。' : '這一題已經失效，請重新取得題目。');
        if (caught.status !== 409) void loadQuestion('pair');
        setSubmitting(false);
        return;
      }
      try {
        await localDb.addPendingAttributeResponse(draft);
        await refreshPendingCount();
        setAwaitingNext(true);
        setVoteFeedback(selectedComparison ? { state: 'saved', text: `已暫存：${comparisonChoiceText(question, selectedComparison)}` } : null);
        setQuestionMotion('idle');
        clearResponse();
        setResponseError('目前無法連線，回答已暫存在本機；恢復連線後會自動同步。');
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
        api.attributeQuestion(sessionId, questionOptions(question, 'pair')),
        reducedMotion() ? Promise.resolve() : wait(SAVED_FEEDBACK_MS),
      ]);
      setOffline(false);
      await animateQuestionChange(nextPayload, 'pair');
    } catch {
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

  if (loading) return <section className="attribute-vote-page"><p>載入中…</p></section>;
  if (error || !payload || !question) return <section className="attribute-vote-page"><h1>屬性投票</h1><p>目前無法取得題目。</p><button type="button" className="button primary" onClick={() => window.location.reload()}>重新載入</button></section>;

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
  const recentComparisons = payload.activities.filter((activity) => activity.kind === 'comparison').slice(0, 3);
  const ratingSuggestion = suggestedComparisonForRatings(ratingA, ratingB);
  const ratingSuggestionText = ratingSuggestion === 'A_HIGHER'
    ? `依照分數，建議點「${question.subjectA.displayName}」`
    : ratingSuggestion === 'B_HIGHER'
      ? `依照分數，建議點「${question.subjectB.displayName}」`
      : ratingSuggestion === 'SIMILAR' ? '依照分數，建議選「差不多」' : '';

  return <section className="attribute-vote-page">
    <header className="attribute-vote-header">
      <h1>屬性投票</h1>
      <div className="attributes-inline-activity" aria-label="最近投票記錄">
        {recentComparisons.length ? <ol>{recentComparisons.map((activity) => <li key={activity.id}><span className="attributes-inline-activity-icon" aria-hidden="true">比</span><span>{activityText(activity)}</span></li>)}</ol> : <span className="attributes-inline-activity-empty">尚無近期紀錄</span>}
      </div>
    </header>

    {(offline || pendingCount > 0) && <p className="attributes-offline-note" role="status">{pendingCount > 0 ? `有 ${pendingCount} 筆回答等待同步。` : '目前離線，回答會先暫存在本機。'} <button type="button" onClick={() => void syncPendingResponses()} disabled={syncing}>{syncing ? '同步中…' : '重新同步'}</button></p>}

    <section className={`attributes-question-card is-${questionMotion}`} aria-labelledby="attributes-question-heading" aria-busy={questionLoading || submitting}>
      <div className="attributes-question-attribute">
        {(lowestExamples.length || highestExamples.length) ? <div className="attributes-question-examples">
          <AttributeScoreAxis ariaLabel="目前資料中的極端分數範例" className="attributes-scoreline-track">
            {lowestExamples.map((example, index) => <ExtremeScoreMarker example={example} direction="low" row={index === 0 ? 'lower' : 'upper'} key={`low:${example.subject.id}`} />)}
            {highestExamples.map((example, index) => <ExtremeScoreMarker example={example} direction="high" row={index === 0 ? 'lower' : 'upper'} key={`high:${example.subject.id}`} />)}
          </AttributeScoreAxis>
        </div> : null}
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
        <button type="button" className="attributes-change-one is-left" aria-label={`換掉${question.subjectA.displayName}`} onClick={() => void loadQuestion('a')} disabled={questionLoading || submitting || awaitingNext}><span aria-hidden="true">↻</span> 換一個</button>
        <button type="button" className={`attributes-similar ${comparison === 'SIMILAR' ? 'is-selected' : ''} ${!submitting && ratingSuggestion === 'SIMILAR' ? 'is-suggested' : ''}`} aria-pressed={comparison === 'SIMILAR'} onClick={() => chooseComparison('SIMILAR')} disabled={questionLoading || submitting || awaitingNext}><span aria-hidden="true">≈</span> 差不多</button>
        <button type="button" className="attributes-change-one is-right" aria-label={`換掉${question.subjectB.displayName}`} onClick={() => void loadQuestion('b')} disabled={questionLoading || submitting || awaitingNext}>換一個 <span aria-hidden="true">↻</span></button>
        <button type="button" className="attributes-unknown" aria-label="不知道，換一組" onClick={() => void loadQuestion('pair')} disabled={questionLoading || submitting || awaitingNext}>不知道</button>
      </div>

      <AttributeRatingTrack leftSubject={question.subjectA} rightSubject={question.subjectB} leftValue={ratingA} rightValue={ratingB} onLeftChange={setRatingA} onRightChange={setRatingB} onLeftClear={() => setRatingA('')} onRightClear={() => setRatingB('')} disabled={questionLoading || submitting || awaitingNext} />

      {ratingSuggestionText && !submitting && <p className="attributes-rating-suggestion" role="status"><span aria-hidden="true">↑</span> {ratingSuggestionText}</p>}

      {responseError && <p className="attributes-response-error" role="alert">{responseError} {awaitingNext && <button type="button" onClick={() => void loadQuestion('pair')} disabled={questionLoading || submitting}>重新取得下一題</button>}</p>}
    </section>

  </section>;
};
