import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { AttributeDefinition, AttributeMatrixValue, AttributeSubject, AttributesPayload } from '../shared/types';

const preferredNames = ['聖瑪利亞號', '格蘭摩爾2'];

const subjectFromParam = (subjects: AttributeSubject[], value: string | null, fallbackIndex: number) =>
  subjects.find((subject) => subject.id === value || subject.slug === value)
  ?? subjects.find((subject) => subject.displayName === preferredNames[fallbackIndex])
  ?? subjects[fallbackIndex];

const attributeFromParam = (attributes: AttributeDefinition[], value: string | null) =>
  attributes.find((attribute) => attribute.id === value || attribute.key === value) ?? attributes[0];

const formatScore = (value: number | undefined) => value == null ? '—' : value.toFixed(1);

const scoreClass = (value: number | undefined) => {
  if (value == null) return 'empty';
  return value >= 7 ? 'high' : value >= 4 ? 'medium' : 'low';
};

const subjectLabel = (subject: AttributeSubject | undefined) => subject?.displayName ?? '尚未選擇';

const scoreMapFromValues = (values: AttributeMatrixValue[]) =>
  new Map(values.map((value) => [`${value.subjectId}:${value.attributeId}`, value]));

export const AttributesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [payload, setPayload] = useState<AttributesPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [subjectAId, setSubjectAId] = useState('');
  const [subjectBId, setSubjectBId] = useState('');
  const [attributeId, setAttributeId] = useState('');
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');

  useEffect(() => {
    let active = true;
    const initialSearchParams = new URLSearchParams(searchParams);
    void api.attributes().then((next) => {
      if (!active) return;
      setPayload(next);
      const subjectA = subjectFromParam(next.subjects, initialSearchParams.get('a'), 0);
      const subjectB = subjectFromParam(next.subjects, initialSearchParams.get('b'), 1);
      const attribute = attributeFromParam(next.attributes, initialSearchParams.get('attribute'));
      if (subjectA) setSubjectAId(subjectA.id);
      if (subjectB && subjectB.id !== subjectA?.id) setSubjectBId(subjectB.id);
      else if (next.subjects[1]) setSubjectBId(next.subjects.find((subject) => subject.id !== subjectA?.id)?.id ?? '');
      if (attribute) setAttributeId(attribute.id);
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const subjects = payload?.subjects ?? [];
  const attributes = payload?.attributes ?? [];
  const values = payload?.values ?? [];
  const scoreMap = useMemo(() => scoreMapFromValues(values), [values]);
  const subjectA = subjects.find((subject) => subject.id === subjectAId);
  const subjectB = subjects.find((subject) => subject.id === subjectBId);
  const selectedAttribute = attributes.find((attribute) => attribute.id === attributeId);
  const filteredSubjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return subjects;
    return subjects.filter((subject) => {
      const componentText = subject.components?.map((component) => component.label).join(' ') ?? '';
      return `${subject.displayName} ${componentText}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [query, subjects]);

  const getValue = (subjectId: string, attributeIdValue: string) => scoreMap.get(`${subjectId}:${attributeIdValue}`);
  const aValue = selectedAttribute && subjectA ? getValue(subjectA.id, selectedAttribute.id) : undefined;
  const bValue = selectedAttribute && subjectB ? getValue(subjectB.id, selectedAttribute.id) : undefined;

  const updateUrl = (nextA: string, nextB: string, nextAttribute: string, nextQuery = query) => {
    const a = subjects.find((subject) => subject.id === nextA);
    const b = subjects.find((subject) => subject.id === nextB);
    const attribute = attributes.find((item) => item.id === nextAttribute);
    if (!a || !b || !attribute) return;
    const nextParams = new URLSearchParams({ a: a.slug, b: b.slug, attribute: attribute.key });
    if (nextQuery.trim()) nextParams.set('q', nextQuery.trim());
    setSearchParams(nextParams, { replace: true });
  };

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

  const changeQuery = (value: string) => {
    setQuery(value);
    const nextParams = new URLSearchParams(searchParams);
    if (value.trim()) nextParams.set('q', value.trim());
    else nextParams.delete('q');
    setSearchParams(nextParams, { replace: true });
  };

  const profileRows = useMemo(() => attributes.map((attribute) => ({
    attribute,
    a: subjectA ? getValue(subjectA.id, attribute.id) : undefined,
    b: subjectB ? getValue(subjectB.id, attribute.id) : undefined,
  })), [attributes, subjectA, subjectB, scoreMap]);

  if (loading) return <section className="narrow-page attributes-page"><p>載入屬性資料中…</p></section>;
  if (error || !payload || subjects.length < 2 || !selectedAttribute) {
    return <section className="narrow-page attributes-page"><h1>屬性比較</h1><p>目前無法載入屬性資料，請稍後重新整理。</p></section>;
  }

  const renderSubjectName = (subject: AttributeSubject) => {
    const name = subject.gameSlug
      ? <Link to={`/games/${encodeURIComponent(subject.gameSlug)}`}>{subject.displayName}</Link>
      : <span>{subject.displayName}</span>;
    return <>{name}<small>{subject.kind === 'configuration' ? '遊戲配置' : '基礎遊戲'}</small></>;
  };

  return <section className="narrow-page attributes-page">
    <header className="attributes-header">
      <div>
        <p className="eyebrow">資料瀏覽</p>
        <h1>桌遊屬性總表</h1>
        <p>把「這款遊戲玩起來的感受」拆成可比較的屬性。這裡只讀取目前共用的遊戲與屬性資料，不會在瀏覽器或伺服器寫入任何內容。</p>
      </div>
      <span className="attributes-data-note">只顯示已有公開規則的遊戲；尚未建立評分的格子會顯示為「—」。</span>
    </header>

    <section className="attributes-selector" aria-label="選擇比較對象與屬性">
      <label>比較對象 A<select value={subjectAId} onChange={(event) => changeSubject('a', event.target.value)}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.displayName}</option>)}</select></label>
      <span className="attributes-versus" aria-hidden="true">VS</span>
      <label>比較對象 B<select value={subjectBId} onChange={(event) => changeSubject('b', event.target.value)}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.displayName}</option>)}</select></label>
      <label className="attributes-attribute-select">比較屬性<select value={attributeId} onChange={(event) => changeAttribute(event.target.value)}>{attributes.map((attribute) => <option key={attribute.id} value={attribute.id}>{attribute.name}</option>)}</select></label>
    </section>

    <section className="attributes-focus-card">
      <div className="attributes-focus-copy"><span className="eyebrow">{selectedAttribute.name}</span><h2>{subjectLabel(subjectA)} <span>與</span> {subjectLabel(subjectB)}</h2><p>{selectedAttribute.fullDescription}</p></div>
      <div className="attributes-score-pair"><div><strong>{formatScore(aValue?.average)}</strong><span>{subjectLabel(subjectA)}<small>{aValue ? `${aValue.count} 筆資料` : '尚無資料'}</small></span></div><div><strong>{formatScore(bValue?.average)}</strong><span>{subjectLabel(subjectB)}<small>{bValue ? `${bValue.count} 筆資料` : '尚無資料'}</small></span></div></div>
    </section>

    <section className="attributes-profile-card" aria-labelledby="attributes-profile-heading">
      <div className="attributes-section-heading"><div><p className="eyebrow">輪廓</p><h2 id="attributes-profile-heading">兩款遊戲的屬性輪廓</h2></div><small>分數為目前資料的平均值</small></div>
      <div className="attributes-profile-list">{profileRows.map(({ attribute, a, b }) => <div className="attributes-profile-row" key={attribute.id}><span>{attribute.name}</span><div className={`attributes-profile-value ${scoreClass(a?.average)}`}><i style={{ width: `${(a?.average ?? 0) * 10}%` }} /><strong>{formatScore(a?.average)}</strong></div><div className={`attributes-profile-value ${scoreClass(b?.average)}`}><i style={{ width: `${(b?.average ?? 0) * 10}%` }} /><strong>{formatScore(b?.average)}</strong></div></div>)}</div>
      <div className="attributes-profile-legend"><span><i className="attributes-legend-a" />{subjectLabel(subjectA)}</span><span><i className="attributes-legend-b" />{subjectLabel(subjectB)}</span></div>
    </section>

    <section className="attributes-table-card" aria-labelledby="attributes-table-heading">
      <div className="attributes-section-heading"><div><p className="eyebrow">完整資料</p><h2 id="attributes-table-heading">屬性總表</h2></div><label className="attributes-search">搜尋遊戲<input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="輸入名稱或配置" /></label></div>
      <div className="attributes-table-meta">顯示 {filteredSubjects.length} / {subjects.length} 個項目・共 {attributes.length} 個屬性</div>
      <div className="attributes-table-scroll">
        <table className="attributes-matrix">
          <thead><tr><th scope="col" className="attributes-matrix-subject">遊戲／配置</th>{attributes.map((attribute) => <th scope="col" key={attribute.id} title={attribute.fullDescription}>{attribute.name}</th>)}</tr></thead>
          <tbody>{filteredSubjects.map((subject) => <tr key={subject.id}><th scope="row" className="attributes-matrix-subject">{renderSubjectName(subject)}</th>{attributes.map((attribute) => { const value = getValue(subject.id, attribute.id); return <td key={attribute.id} className={`attributes-matrix-value ${scoreClass(value?.average)}`} title={value ? `${value.count} 筆資料，平均 ${formatScore(value.average)}` : '尚無資料'}>{formatScore(value?.average)}</td>; })}</tr>)}</tbody>
        </table>
      </div>
    </section>
  </section>;
};
