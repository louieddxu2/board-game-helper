import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { createAttributeResponseId, getAttributeSessionId } from '../lib/attributeSession';
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
  const [comparison, setComparison] = useState<AttributeComparisonResult | null>(null);
  const [ratingA, setRatingA] = useState('');
  const [ratingB, setRatingB] = useState('');
  const [sessionId] = useState(getAttributeSessionId);

  const clearResponse = () => {
    setComparison(null);
    setRatingA('');
    setRatingB('');
    setResponseError('');
  };

  const loadQuestion = useCallback(async (mode: 'pair' | 'a' | 'b' = 'pair') => {
    setQuestionLoading(true);
    try {
      const next = await api.attributeQuestion(sessionId, questionOptions(question, mode));
      setQuestion(next.question ?? undefined);
      clearResponse();
    } catch {
      setResponseError('目前無法換下一題，請稍後再試。');
    } finally {
      setQuestionLoading(false);
    }
  }, [question, sessionId]);

  useEffect(() => {
    let active = true;
    void api.attributeQuestion(sessionId)
      .then((nextPayload) => {
        if (!active) return;
        setPayload(nextPayload);
        setQuestion(nextPayload.question ?? undefined);
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  const submitResponse = async () => {
    if (!question) return;
    const parsedRatingA = ratingA === '' ? null : Number(ratingA);
    const parsedRatingB = ratingB === '' ? null : Number(ratingB);
    if (comparison == null && parsedRatingA == null && parsedRatingB == null) {
      setResponseError('請至少選一個比較結果或填一個分數。');
      return;
    }
    setSubmitting(true);
    setResponseError('');
    try {
      await api.saveAttributeResponse({
        subjectAId: question.subjectA.id,
        subjectBId: question.subjectB.id,
        attributeId: question.attribute.id,
        responseId: createAttributeResponseId(),
        comparison,
        ratingA: parsedRatingA,
        ratingB: parsedRatingB,
        sessionId,
      });
      const nextPayload = await api.attributeQuestion(sessionId, questionOptions(question, 'pair'));
      setPayload(nextPayload);
      setQuestion(nextPayload.question ?? undefined);
      clearResponse();
    } catch {
      setResponseError('送出時發生問題，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <section className="narrow-page attributes-page"><p>載入屬性投票中…</p></section>;
  if (error || !payload || !question) return <section className="narrow-page attributes-page"><h1>屬性比較</h1><p>目前沒有可用的屬性題目，請稍後重新整理。</p></section>;

  return <section className="narrow-page attributes-page">
    <header className="attributes-header">
      <div>
        <p className="eyebrow">無限投票</p>
        <h1>桌遊屬性比較</h1>
        <p>系統會自動挑選兩款遊戲與一項屬性。你可以比較兩款遊戲，也可以同時填寫各自的 0～10 分數；送出後會自動換下一題。</p>
      </div>
      <span className="attributes-data-note">題目會優先照顧比較資料少、屬性資料不足的組合，同時保留隨機性。兩兩比較也會納入總表的合成分數。</span>
    </header>

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
      {responseError && <p className="attributes-response-error" role="alert">{responseError}</p>}
      <button type="button" className="button primary attributes-submit" onClick={() => void submitResponse()} disabled={submitting || questionLoading}>{submitting ? '儲存中…' : '送出回答，換下一題'}</button>
    </section>

  </section>;
};
