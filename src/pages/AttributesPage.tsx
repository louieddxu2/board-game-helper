import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getAttributeSessionId } from '../lib/attributeSession';
import type { AttributeComparisonResult, AttributeDefinition, AttributeSubject, AttributeWorkbenchPayload, AttributesPayload } from '../shared/types';

const preferredNames = ['聖瑪利亞號', '格蘭摩爾2'];

const subjectFromParam = (subjects: AttributeSubject[], value: string | null, fallbackIndex: number) =>
  subjects.find((subject) => subject.id === value || subject.slug === value)
  ?? subjects.find((subject) => subject.displayName === preferredNames[fallbackIndex])
  ?? subjects[fallbackIndex];

const attributeFromParam = (attributes: AttributeDefinition[], value: string | null) =>
  attributes.find((attribute) => attribute.id === value || attribute.key === value) ?? attributes[0];

const formatScore = (value: number | undefined) => value == null ? '—' : value.toFixed(1);

const scoreClass = (value: number) => value >= 7 ? 'high' : value >= 4 ? 'medium' : 'low';

const subjectLabel = (subject: AttributeSubject | undefined) => subject?.displayName ?? '尚未選擇';

export const AttributesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [payload, setPayload] = useState<AttributesPayload>();
  const [workbench, setWorkbench] = useState<AttributeWorkbenchPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [subjectAId, setSubjectAId] = useState('');
  const [subjectBId, setSubjectBId] = useState('');
  const [attributeId, setAttributeId] = useState('');
  const [sessionId] = useState(getAttributeSessionId);
  const [saving, setSaving] = useState('');
  const initialized = useRef(false);
  const initialSearchParams = useRef(new URLSearchParams(searchParams));

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.attributes().then((next) => {
      if (!active) return;
      setPayload(next);
      const subjectA = subjectFromParam(next.subjects, initialSearchParams.current.get('a'), 0);
      const subjectB = subjectFromParam(next.subjects, initialSearchParams.current.get('b'), 1);
      const attribute = attributeFromParam(next.attributes, initialSearchParams.current.get('attribute'));
      if (subjectA) setSubjectAId(subjectA.id);
      if (subjectB && subjectB.id !== subjectA?.id) setSubjectBId(subjectB.id);
      else if (next.subjects[1]) setSubjectBId(next.subjects.find((subject) => subject.id !== subjectA?.id)?.id ?? '');
      if (attribute) setAttributeId(attribute.id);
      initialized.current = true;
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const subjects = payload?.subjects ?? [];
  const attributes = payload?.attributes ?? [];
  const subjectA = subjects.find((subject) => subject.id === subjectAId);
  const subjectB = subjects.find((subject) => subject.id === subjectBId);
  const selectedAttribute = attributes.find((attribute) => attribute.id === attributeId);

  const updateUrl = (nextA: string, nextB: string, nextAttribute: string) => {
    const a = subjects.find((subject) => subject.id === nextA);
    const b = subjects.find((subject) => subject.id === nextB);
    const attribute = attributes.find((item) => item.id === nextAttribute);
    if (!a || !b || !attribute) return;
    setSearchParams({ a: a.slug, b: b.slug, attribute: attribute.key }, { replace: true });
  };

  useEffect(() => {
    if (!initialized.current || !subjectAId || !subjectBId || !attributeId || subjectAId === subjectBId) return;
    let active = true;
    setWorkbench(undefined);
    void api.attributeWorkbench(subjectAId, subjectBId, attributeId, sessionId)
      .then((next) => { if (active) setWorkbench(next); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attributeId, sessionId, subjectAId, subjectBId]);

  const changeSubject = (side: 'a' | 'b', value: string) => {
    const nextA = side === 'a' ? value : subjectAId;
    const nextB = side === 'b' ? value : subjectBId;
    if (nextA === nextB) return;
    if (side === 'a') setSubjectAId(value);
    else setSubjectBId(value);
    updateUrl(nextA, nextB, attributeId);
  };

  const changeAttribute = (value: string) => {
    setAttributeId(value);
    updateUrl(subjectAId, subjectBId, value);
  };

  const saveRating = async (subjectId: string, value: number) => {
    if (!selectedAttribute) return;
    const key = `rating:${subjectId}`;
    setSaving(key);
    try {
      await api.saveAttributeRating({ subjectId, attributeId: selectedAttribute.id, value, sessionId });
      const next = await api.attributeWorkbench(subjectAId, subjectBId, selectedAttribute.id, sessionId);
      setWorkbench(next);
    } catch {
      setError(true);
    } finally {
      setSaving('');
    }
  };

  const saveComparison = async (result: AttributeComparisonResult) => {
    if (!selectedAttribute) return;
    setSaving(`comparison:${result}`);
    try {
      await api.saveAttributeComparison({ subjectAId, subjectBId, attributeId: selectedAttribute.id, result, sessionId });
      const next = await api.attributeWorkbench(subjectAId, subjectBId, selectedAttribute.id, sessionId);
      setWorkbench(next);
    } catch {
      setError(true);
    } finally {
      setSaving('');
    }
  };

  const profileRows = useMemo(() => {
    if (!workbench) return [];
    return attributes.map((attribute) => ({
      attribute,
      a: workbench.profile.a.find((row) => row.attributeId === attribute.id),
      b: workbench.profile.b.find((row) => row.attributeId === attribute.id),
    }));
  }, [attributes, workbench]);

  if (loading) return <section className="narrow-page attributes-page"><p>載入屬性資料中…</p></section>;
  if (error || !payload || subjects.length < 2 || !selectedAttribute) {
    return <section className="narrow-page attributes-page"><h1>屬性比較</h1><p>目前無法載入屬性資料，請稍後重新整理。</p></section>;
  }

  const renderRating = (subject: AttributeSubject | undefined, value: number | undefined, myValue: number | undefined) => (
    <div className="attributes-rating-panel">
      <div className="attributes-rating-heading"><strong>{subjectLabel(subject)}</strong><span>{myValue == null ? '尚未評分' : `我的評分 ${myValue}`}</span></div>
      <div className="attributes-rating-buttons" role="group" aria-label={`${subjectLabel(subject)}評分`}>
        {Array.from({ length: 11 }, (_, score) => <button
          key={score}
          type="button"
          className={myValue === score ? 'active' : ''}
          disabled={saving === `rating:${subject?.id}`}
          onClick={() => { if (subject) void saveRating(subject.id, score); }}
        >{score}</button>)}
      </div>
      <small>目前彙整：{formatScore(value)}（{workbench?.scores[subject?.id === subjectAId ? 'a' : 'b'].count ?? 0} 筆）</small>
    </div>
  );

  return <section className="narrow-page attributes-page">
    <header className="attributes-header">
      <div>
        <p className="eyebrow">新功能雛形</p>
        <h1>桌遊屬性比較</h1>
        <p>把「這款遊戲玩起來的感受」拆成可比較的屬性。這裡的比較對象是獨立的 subject，未來可以容納基礎版與擴充組合，而不改變玩錯規則的遊戲資料。</p>
      </div>
      <span className="attributes-data-note">目前先顯示可安全對應到既有遊戲的資料</span>
    </header>

    <section className="attributes-selector" aria-label="選擇比較對象">
      <label>比較對象 A<select value={subjectAId} onChange={(event) => changeSubject('a', event.target.value)}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.displayName}</option>)}</select></label>
      <span className="attributes-versus" aria-hidden="true">VS</span>
      <label>比較對象 B<select value={subjectBId} onChange={(event) => changeSubject('b', event.target.value)}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.displayName}</option>)}</select></label>
      <label className="attributes-attribute-select">比較屬性<select value={attributeId} onChange={(event) => changeAttribute(event.target.value)}>{attributes.map((attribute) => <option key={attribute.id} value={attribute.id}>{attribute.name}</option>)}</select></label>
    </section>

    <section className="attributes-focus-card">
      <div className="attributes-focus-copy"><span className="eyebrow">{selectedAttribute.name}</span><h2>{subjectLabel(subjectA)} <span>與</span> {subjectLabel(subjectB)}</h2><p>{selectedAttribute.fullDescription}</p></div>
      <div className="attributes-score-pair"><div><strong>{formatScore(workbench?.scores.a.average)}</strong><span>{subjectLabel(subjectA)}</span></div><div><strong>{formatScore(workbench?.scores.b.average)}</strong><span>{subjectLabel(subjectB)}</span></div></div>
    </section>

    <section className="attributes-action-grid">
      {renderRating(subjectA, workbench?.scores.a.average, workbench?.scores.a.myValue)}
      {renderRating(subjectB, workbench?.scores.b.average, workbench?.scores.b.myValue)}
      <div className="attributes-comparison-panel"><div className="attributes-rating-heading"><strong>快速比較</strong><span>{workbench?.myComparison ? `我選了：${workbench.myComparison === 'A_HIGHER' ? 'A 較高' : workbench.myComparison === 'B_HIGHER' ? 'B 較高' : '相近'}` : '尚未選擇'}</span></div><div className="attributes-comparison-buttons">{([['A_HIGHER', `${subjectLabel(subjectA)} 較高`], ['SIMILAR', '相近'], ['B_HIGHER', `${subjectLabel(subjectB)} 較高`]] as const).map(([result, label]) => <button key={result} type="button" className={workbench?.myComparison === result ? 'active' : ''} disabled={saving.startsWith('comparison:')} onClick={() => void saveComparison(result)}>{label}</button>)}</div><small>{(workbench?.comparisons ?? []).map((item) => `${item.result === 'A_HIGHER' ? 'A 較高' : item.result === 'B_HIGHER' ? 'B 較高' : '相近'} ${item.count} 票`).join('・') || '還沒有其他比較紀錄'}</small></div>
    </section>

    <section className="attributes-profile-card"><div className="attributes-section-heading"><div><p className="eyebrow">輪廓</p><h2>完整屬性輪廓</h2></div><small>分數來自目前已寫入的評分</small></div><div className="attributes-profile-list">{profileRows.map(({ attribute, a, b }) => <div className="attributes-profile-row" key={attribute.id}><span>{attribute.name}</span><div className={`attributes-profile-value ${scoreClass(a?.average ?? 0)}`}><i style={{ width: `${(a?.average ?? 0) * 10}%` }} /><strong>{formatScore(a?.average)}</strong></div><div className={`attributes-profile-value ${scoreClass(b?.average ?? 0)}`}><i style={{ width: `${(b?.average ?? 0) * 10}%` }} /><strong>{formatScore(b?.average)}</strong></div></div>)}</div><div className="attributes-profile-legend"><span><i className="attributes-legend-a" />{subjectLabel(subjectA)}</span><span><i className="attributes-legend-b" />{subjectLabel(subjectB)}</span></div></section>
  </section>;
};
