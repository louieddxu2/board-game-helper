import { useEffect, useState } from 'react';
import { AttributeMatrixTable } from '../components/AttributeMatrixTable';
import { api } from '../lib/api';
import type { AttributesPayload } from '../shared/types';

export const AttributeTablePage = () => {
  const [payload, setPayload] = useState<AttributesPayload>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void api.attributes()
      .then((nextPayload) => { if (active) setPayload(nextPayload); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const loadMore = async (scope: 'subjects' | 'candidates') => {
    if (!payload || (scope === 'subjects' ? !payload.hasMoreSubjects : !payload.hasMoreCandidates)) return;
    setLoadingMore(true);
    try {
      const next = await api.attributes({
        subjectCursor: payload.nextSubjectCursor ?? undefined,
        candidateCursor: payload.nextCandidateCursor ?? undefined,
        scope,
      });
      setPayload({
        ...next,
        attributes: payload.attributes,
        subjects: [...payload.subjects, ...next.subjects.filter((subject) => !payload.subjects.some((current) => current.id === subject.id))],
        values: [...payload.values, ...next.values.filter((value) => !payload.values.some((current) => current.subjectId === value.subjectId && current.attributeId === value.attributeId))],
        candidates: [...payload.candidates, ...next.candidates.filter((candidate) => !payload.candidates.some((current) => current.id === candidate.id))],
      });
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) return <section className="narrow-page attributes-page"><p>載入屬性總表中…</p></section>;
  if (error || !payload) return <section className="narrow-page attributes-page"><h1>屬性總表</h1><p>目前無法載入屬性資料，請稍後重新整理。</p></section>;

  return <section className="narrow-page attributes-page">
    <header className="attributes-header">
      <div>
        <p className="eyebrow">唯讀資料</p>
        <h1>桌遊屬性總表</h1>
        <p>這裡集中查看所有已對應遊戲、尚未處理的匯入項目，以及各屬性的目前合成分數。頁面不提供編輯功能。</p>
      </div>
      <span className="attributes-data-note">目前計分模型：{payload.scoreModelVersion ?? 'glicko-rd-v1'}。直接評分與兩兩比較會保留各自的資料量，RD 越高代表越需要補充資料。</span>
    </header>
    <AttributeMatrixTable payload={payload} />
    {(payload.hasMoreSubjects || payload.hasMoreCandidates) && <div className="attributes-table-more">
      {payload.hasMoreSubjects && <button type="button" className="button secondary" onClick={() => void loadMore('subjects')} disabled={loadingMore}>{loadingMore ? '載入中…' : '載入更多遊戲'}</button>}
      {payload.hasMoreCandidates && <button type="button" className="button secondary" onClick={() => void loadMore('candidates')} disabled={loadingMore}>{loadingMore ? '載入中…' : '載入更多尚未處理項目'}</button>}
    </div>}
  </section>;
};
