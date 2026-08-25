import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { createAttributeResponseId, getAttributeSessionId } from '../lib/attributeSession';
import { localDb, type PendingAttributeResponse } from '../lib/localDb';
import type { AttributeActivity, AttributeComparisonResult, AttributeQuestion, AttributeQuestionPayload } from '../shared/types';

const resultLabel = (result: AttributeComparisonResult) => {
  if (result === 'A_HIGHER') return 'A 較高';
  if (result === 'B_HIGHER') return 'B 較高';
  return '差不多';
};

const formatActivityTime = (timestamp: number) => new Intl.DateTimeFormat('zh-TW', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(timestamp));

const subjectName = (subject: { displayName: string; gameSlug?: string; slug?: string }) => {
  const slug = subject.gameSlug;
  return slug
    ? <Link to={`/games/${encodeURIComponent(slug)}`}>{subject.displayName}</Link>
  : <span>{subject.displayName}</span>;
};

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

  if (loading) return <section className="narrow-page attributes-page"><p>載入屬性投票中…</p></section>;
  if (error || !payload || !question) return <section className="narrow-page attributes-page"><h1>屬性比較</h1><p>目前無法取得屬性題目。</p><button type="button" className="button primary" onClick={() => window.location.reload()}>重新載入</button></section>;

  return <section className="narrow-page attributes-page">
    <header className="attributes-header">
      <div>
        <p className="eyebrow">無限投票</p>
        <h1>桌遊屬性比較</h1>
        <p>系統會先挑出一款信心度較低的遊戲，再從相同屬性的其他遊戲中隨機抽出另一款。你可以比較兩款遊戲，也可以同時填寫各自的 0～10 分數；送出後會自動換下一題。</p>
      </div>
      <span className="attributes-data-note">第一款依信心度抽選，第二款在同一屬性中隨機抽選；比較與分數都會納入總表的合成分數。</span>
    </header>

    {(offline || pendingCount > 0) && <p className="attributes-offline-note" role="status">{pendingCount > 0 ? `有 ${pendingCount} 筆回答等待同步。` : '目前離線，回答會先暫存在本機。'} <button type="button" onClick={() => void syncPendingResponses()} disabled={syncing}>{syncing ? '同步中…' : '重新同步'}</button></p>}

    <section className="attributes-activity-card" aria-labelledby="attributes-activity-heading">
      <div className="attributes-section-heading"><div><p className="eyebrow">即時動態</p><h2 id="attributes-activity-heading">近期投票記錄</h2></div><small>最新 12 筆</small></div>
      {payload.activities.length ? <ol className="attributes-activity-list">{payload.activities.map((activity) => <li key={`${activity.kind}:${activity.id}`}><span className="attributes-activity-icon" aria-hidden="true">{activity.kind === 'rating' ? '分' : '比'}</span><div><p>{activityText(activity)}</p><time dateTime={new Date(activity.createdAt).toISOString()}>{formatActivityTime(activity.createdAt)}</time></div></li>)}</ol> : <p className="attributes-empty-activity">還沒有投票記錄；你的第一筆回答會出現在這裡。</p>}
    </section>

    <section className="attributes-question-card" aria-labelledby="attributes-question-heading">
      <div className="attributes-question-topline"><span className="eyebrow">這一題</span><button type="button" className="attributes-change-pair" onClick={() => void loadQuestion('pair')} disabled={questionLoading || submitting}>↻ 換一組</button></div>
      <div className="attributes-question-attribute"><h2 id="attributes-question-heading">{question.attribute.name}</h2><p>{question.attribute.fullDescription}</p></div>
      <div className="attributes-question-pair">
        <article className="attributes-question-game"><span className="attributes-question-letter">A</span><h3>{subjectName(question.subjectA)}</h3><button type="button" onClick={() => void loadQuestion('a')} disabled={questionLoading || submitting}>換 A</button></article>
        <span className="attributes-versus" aria-hidden="true">VS</span>
        <article className="attributes-question-game"><span className="attributes-question-letter attributes-question-letter-b">B</span><h3>{subjectName(question.subjectB)}</h3><button type="button" onClick={() => void loadQuestion('b')} disabled={questionLoading || submitting}>換 B</button></article>
      </div>

      <div className="attributes-answer-grid">
        <fieldset className="attributes-comparison-fieldset"><legend>哪一款在「{question.attribute.name}」較高？</legend><div className="attributes-comparison-buttons">{([['A_HIGHER', `${question.subjectA.displayName} 較高`], ['SIMILAR', '差不多'], ['B_HIGHER', `${question.subjectB.displayName} 較高`]] as const).map(([result, label]) => <button key={result} type="button" className={comparison === result ? 'active' : ''} onClick={() => setComparison(result)}>{label}</button>)}</div></fieldset>
        <fieldset className="attributes-rating-fieldset"><legend>也可以同時填分數（0～10）</legend><div className="attributes-rating-inputs"><label>A（{question.subjectA.displayName}）<input type="number" min="0" max="10" step="1" value={ratingA} onChange={(event) => setRatingA(event.target.value)} placeholder="—" /></label><label>B（{question.subjectB.displayName}）<input type="number" min="0" max="10" step="1" value={ratingB} onChange={(event) => setRatingB(event.target.value)} placeholder="—" /></label></div></fieldset>
      </div>
      {responseError && <p className="attributes-response-error" role="alert">{responseError} {awaitingNext && <button type="button" onClick={() => void loadQuestion('pair')} disabled={questionLoading || submitting}>重新取得下一題</button>}</p>}
      <button type="button" className="button primary attributes-submit" onClick={() => void submitResponse()} disabled={submitting || questionLoading || awaitingNext || offline}>{submitting ? '儲存中…' : offline ? '離線暫存中' : '送出回答，換下一題'}</button>
    </section>

  </section>;
};
