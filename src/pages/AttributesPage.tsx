import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getAttributeSessionId } from '../lib/attributeSession';
import type { AttributeActivity, AttributeComparisonResult, AttributeDefinition, AttributeQuestion, AttributeSubject, AttributesPayload } from '../shared/types';

type TableFilter = 'all' | 'processed' | 'pending';

interface AttributeTableRow {
  id: string;
  displayName: string;
  kind: 'processed' | 'pending';
  statusLabel: string;
  gameSlug?: string;
  values: Array<number | undefined>;
}

const formatScore = (value: number | undefined) => value == null ? '—' : value.toFixed(1);

const scoreClass = (value: number | undefined) => {
  if (value == null) return 'empty';
  return value >= 7 ? 'high' : value >= 4 ? 'medium' : 'low';
};

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
  const [payload, setPayload] = useState<AttributesPayload>();
  const [question, setQuestion] = useState<AttributeQuestion>();
  const [loading, setLoading] = useState(true);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [responseError, setResponseError] = useState('');
  const [comparison, setComparison] = useState<AttributeComparisonResult | null>(null);
  const [ratingA, setRatingA] = useState('');
  const [ratingB, setRatingB] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [tableFilter, setTableFilter] = useState<TableFilter>('all');
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
    void Promise.all([api.attributes(), api.attributeQuestion(sessionId)])
      .then(([nextPayload, nextQuestion]) => {
        if (!active) return;
        setPayload(nextPayload);
        setQuestion(nextQuestion.question ?? undefined);
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  const valueMap = useMemo(() => new Map((payload?.values ?? []).map((value) => [`${value.subjectId}:${value.attributeId}`, value])), [payload?.values]);
  const tableRows = useMemo<AttributeTableRow[]>(() => {
    if (!payload) return [];
    const processed: AttributeTableRow[] = payload.subjects.map((subject) => ({
      id: subject.id,
      displayName: subject.displayName,
      kind: 'processed',
      statusLabel: subject.kind === 'configuration' ? '已建立配置' : '已對應遊戲',
      gameSlug: subject.gameSlug,
      values: payload.attributes.map((attribute) => valueMap.get(`${subject.id}:${attribute.id}`)?.average),
    }));
    const pending: AttributeTableRow[] = payload.candidates.map((candidate) => ({
      id: `candidate:${candidate.id}`,
      displayName: candidate.displayName,
      kind: 'pending',
      statusLabel: candidate.matchStatus === 'ambiguous' ? '待確認來源' : '待對應遊戲',
      values: payload.attributes.map((_, index) => candidate.values[index] ?? undefined),
    }));
    return [...processed, ...pending];
  }, [payload, valueMap]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = tableQuery.trim().toLocaleLowerCase();
    return tableRows.filter((row) => {
      if (tableFilter === 'processed' && row.kind !== 'processed') return false;
      if (tableFilter === 'pending' && row.kind !== 'pending') return false;
      return !normalizedQuery || row.displayName.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [tableFilter, tableQuery, tableRows]);

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
        comparison,
        ratingA: parsedRatingA,
        ratingB: parsedRatingB,
        sessionId,
      });
      const [nextPayload, nextQuestion] = await Promise.all([
        api.attributes(),
        api.attributeQuestion(sessionId, questionOptions(question, 'pair')),
      ]);
      setPayload(nextPayload);
      setQuestion(nextQuestion.question ?? undefined);
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
      <span className="attributes-data-note">題目會優先照顧比較資料少、屬性資料不足的組合，同時保留隨機性。</span>
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

    <section className="attributes-table-card" aria-labelledby="attributes-table-heading">
      <div className="attributes-section-heading"><div><p className="eyebrow">完整資料</p><h2 id="attributes-table-heading">屬性總表</h2></div><label className="attributes-search">搜尋遊戲或來源項目<input type="search" value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="輸入名稱" /></label></div>
      <div className="attributes-table-toolbar"><div className="attributes-table-filters" role="group" aria-label="資料狀態篩選">{([['all', '全部'], ['processed', '已對應'], ['pending', '尚未處理']] as const).map(([filter, label]) => <button type="button" key={filter} className={tableFilter === filter ? 'active' : ''} onClick={() => setTableFilter(filter)}>{label}</button>)}</div><span>顯示 {visibleRows.length} / {tableRows.length} 個項目・{payload.attributes.length} 個屬性</span></div>
      <div className="attributes-table-scroll">
        <table className="attributes-matrix">
          <thead><tr><th scope="col" className="attributes-matrix-subject">遊戲／來源項目</th>{payload.attributes.map((attribute) => <th scope="col" key={attribute.id} title={attribute.fullDescription}>{attribute.name}</th>)}</tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.id} className={row.kind === 'pending' ? 'attributes-matrix-pending' : undefined}><th scope="row" className="attributes-matrix-subject">{row.gameSlug ? <Link to={`/games/${encodeURIComponent(row.gameSlug)}`}>{row.displayName}</Link> : <span>{row.displayName}</span>}<small>{row.statusLabel}</small></th>{row.values.map((value, index) => <td key={payload.attributes[index]?.id ?? index} className={`attributes-matrix-value ${scoreClass(value)}`} title={value == null ? '尚無資料' : `平均 ${formatScore(value)}`}>{formatScore(value)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  </section>;
};
