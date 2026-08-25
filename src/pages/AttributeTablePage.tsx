import { useEffect, useState } from 'react';
import { AttributeMatrixTable } from '../components/AttributeMatrixTable';
import { api } from '../lib/api';
import type { AttributeCatalogPayload } from '../shared/types';

export const AttributeTablePage = () => {
  const [payload, setPayload] = useState<AttributeCatalogPayload>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void api.attributeTable((updated) => { if (active) setPayload(updated); })
      .then((nextPayload) => { if (active) setPayload(nextPayload); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <section className="narrow-page attributes-page"><p>載入屬性總表中…</p></section>;
  if (error || !payload) return <section className="narrow-page attributes-page"><h1>屬性總表</h1><p>目前無法載入屬性資料，請稍後重新整理。</p></section>;

  return <section className="narrow-page attributes-page">
    <header className="attributes-header">
      <div>
        <p className="eyebrow">唯讀資料</p>
        <h1>桌遊屬性總表</h1>
        <p>這裡集中查看所有已對應遊戲、尚未處理的匯入項目，以及各屬性的目前合成分數。頁面不提供編輯功能。</p>
      </div>
      <span className="attributes-data-note">目前計分模型：{payload.scoreModelVersion ?? 'glicko-rd-v1'}。直接評分與兩兩比較會保留各自的資料量，RD 越高代表越需要補充資料。總表會以快照搭配增量資料同步。</span>
    </header>
    <AttributeMatrixTable payload={payload} />
  </section>;
};
