import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { createAttributeResponseId, getAttributeSessionId } from '../lib/attributeSession';
import { localDb, type PendingAttributeResponse } from '../lib/localDb';
import type { AttributeActivity, AttributeComparisonResult, AttributeQuestion, AttributeQuestionPayload } from '../shared/types';

const resultLabel = (result: AttributeComparisonResult) => {
  if (result === 'A_HIGHER') return 'A 較高';
  if (result === 'B_HIGHER') return 'B 較高';
  return '差不多';
};

const subjectName = (subject: { displayName: string }) => <span>{subject.displayName}</span>;

const activityText = (activity: AttributeActivity) => {
  if (activity.kind === 'rating' && activity.subject) {
    return <>{activity.actorName} 給 {subjectName(activity.subject)} 的「{activity.attributeName}」{activity.value} 分</>;
  }
  if (activity.subjectA && activity.subjectB && activity.result) {
    return <>{activity.actorName} 認為 {subjectName(activity.subjectA)} 與 {subjectName(activity.subjectB)} 的「{activity.attributeName}」{resultLabel(activity.result)}</>;
  }
  return `${activity.actorName} 完成了一筆屬性投票`;
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
  const [sessionId] = useState(getAttributeSessionId);
  const responseIdRef = useRef<string | undefined>(undefined);
  const syncingRef = useRef(false);

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
      applyQuestionPayload(next);
    } catch {
      setResponseError('目前無法換下一題，請稍後再試。');
    } finally {
      setQuestionLoading(false);
    }
  }, [applyQuestionPayload, question, sessionId]);

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

  const submitResponse = async () => {
    if (!question) return;
    const parsedRatingA = ratingA === '' ? null : Number(ratingA);
    const parsedRatingB = ratingB === '' ? null : Number(ratingB);
    if (comparison == null && parsedRatingA == null && parsedRatingB == null) {
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
      comparison,
      ratingA: parsedRatingA,
      ratingB: parsedRatingB,
      sessionId,
    } satisfies Omit<PendingAttributeResponse, 'id' | 'createdAt'>;
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new TypeError('offline');
      await api.saveAttributeResponse(draft);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        setResponseError(caught.status === 409 ? '目前回答較多，請再按一次送出。' : '這一題已經失效，請重新取得題目。');
        if (caught.status !== 409) void loadQuestion('pair');
        setSubmitting(false);
        return;
      }
      try {
        await localDb.addPendingAttributeResponse(draft);
        await refreshPendingCount();
        setAwaitingNext(true);
        clearResponse();
        setResponseError('目前無法連線，回答已暫存在本機；恢復連線後會自動同步。');
      } catch {
        setResponseError('目前無法送出或暫存回答，請確認網路後再試。');
      }
      setSubmitting(false);
      return;
    }
    responseIdRef.current = undefined;
    setAwaitingNext(false);
    try {
      const nextPayload = await api.attributeQuestion(sessionId, questionOptions(question, 'pair'));
      setOffline(false);
      applyQuestionPayload(nextPayload);
    } catch {
      setAwaitingNext(true);
      clearResponse();
      setResponseError('回答已儲存，但目前無法取得下一題；請按「重新取得下一題」。');
    } finally {
      setSubmitting(false);
    }
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

  return <section className="attribute-vote-page">
    <header className="attribute-vote-header">
      <h1>屬性投票</h1>
      <div className="attributes-inline-activity" aria-label="最近投票記錄">
        {payload.activities.length ? <ol>{payload.activities.slice(0, 3).map((activity) => <li key={`${activity.kind}:${activity.id}`}><span className="attributes-inline-activity-icon" aria-hidden="true">{activity.kind === 'rating' ? '分' : '比'}</span><span>{activityText(activity)}</span></li>)}</ol> : <span className="attributes-inline-activity-empty">尚無近期紀錄</span>}
      </div>
    </header>

    {(offline || pendingCount > 0) && <p className="attributes-offline-note" role="status">{pendingCount > 0 ? `有 ${pendingCount} 筆回答等待同步。` : '目前離線，回答會先暫存在本機。'} <button type="button" onClick={() => void syncPendingResponses()} disabled={syncing}>{syncing ? '同步中…' : '重新同步'}</button></p>}

    <section className="attributes-question-card" aria-labelledby="attributes-question-heading">
      <div className="attributes-question-attribute">
        <h2 id="attributes-question-heading">哪款遊戲的<strong>「{question.attribute.name}」</strong>較多？</h2>
        {question.attribute.fullDescription && <p>{question.attribute.fullDescription}</p>}
        {(lowestExamples.length || highestExamples.length) ? <div className="attributes-question-examples" aria-label="目前資料中的極端分數範例">
          <div className="attributes-scoreline-track">
            {lowestExamples.map((example, index) => <span className={`attributes-scoreline-marker is-low ${index === 0 ? 'is-lower' : 'is-upper'}`} key={`low:${example.subject.id}`} style={{ left: `${example.score * 10}%` }} title={`${example.score} 分：${example.subject.displayName}`}>{subjectName(example.subject)}</span>)}
            {highestExamples.map((example, index) => <span className={`attributes-scoreline-marker is-high ${index === 0 ? 'is-lower' : 'is-upper'}`} key={`high:${example.subject.id}`} style={{ left: `${example.score * 10}%` }} title={`${example.score} 分：${example.subject.displayName}`}>{subjectName(example.subject)}</span>)}
            <div className="attributes-scoreline" aria-hidden="true"><span>0</span><i /><span>5</span><i /><span>10</span></div>
          </div>
        </div> : null}
      </div>
      <div className="attributes-question-pair">
        <article className="attributes-question-game"><span className="attributes-question-letter">A</span><h3>{subjectName(question.subjectA)}</h3></article>
        <span className="attributes-versus" aria-hidden="true">VS</span>
        <article className="attributes-question-game"><span className="attributes-question-letter attributes-question-letter-b">B</span><h3>{subjectName(question.subjectB)}</h3></article>
      </div>

      <div className="attributes-answer-grid">
        <fieldset className="attributes-comparison-fieldset"><legend>選擇較高者</legend><div className="attributes-comparison-buttons">{([['A_HIGHER', 'A 較高'], ['SIMILAR', '差不多'], ['B_HIGHER', 'B 較高']] as const).map(([result, label]) => <button key={result} type="button" className={comparison === result ? 'active' : ''} onClick={() => setComparison(result)}>{label}</button>)}</div></fieldset>
        <fieldset className="attributes-rating-fieldset"><legend>也可給分（0～10）</legend><div className="attributes-rating-inputs"><label><span>A／{question.subjectA.displayName}</span><input aria-label={`A：${question.subjectA.displayName}`} type="number" min="0" max="10" step="1" value={ratingA} onChange={(event) => setRatingA(event.target.value)} placeholder="—" /></label><span className="attributes-rating-center" aria-hidden="true"> </span><label><span>B／{question.subjectB.displayName}</span><input aria-label={`B：${question.subjectB.displayName}`} type="number" min="0" max="10" step="1" value={ratingB} onChange={(event) => setRatingB(event.target.value)} placeholder="—" /></label></div></fieldset>
      </div>
      {responseError && <p className="attributes-response-error" role="alert">{responseError} {awaitingNext && <button type="button" onClick={() => void loadQuestion('pair')} disabled={questionLoading || submitting}>重新取得下一題</button>}</p>}
      <div className="attributes-submit-row"><button type="button" className="button primary attributes-submit" onClick={() => void submitResponse()} disabled={submitting || questionLoading || awaitingNext || offline}>{submitting ? '儲存中…' : offline ? '離線暫存中' : '送出回答，換下一題'}</button><button type="button" className="attributes-change-pair" aria-label="換一組" title="換一組" onClick={() => void loadQuestion('pair')} disabled={questionLoading || submitting}>↻</button></div>
    </section>

  </section>;
};
