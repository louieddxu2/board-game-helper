import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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

  if (loading) return <section className="attribute-table-page"><p>載入中…</p></section>;
  if (error || !payload) return <section className="attribute-table-page"><h1>屬性總表</h1><p>目前無法載入資料。</p></section>;

  return <section className="attribute-table-page">
    <header className="attribute-table-header">
      <div><h1>屬性總表</h1><span>{payload.subjects.length} 款遊戲・{payload.attributes.length} 項屬性</span></div>
      <Link className="attributes-vote-link" to="/attributes">返回投票</Link>
    </header>
    <AttributeMatrixTable payload={payload} />
  </section>;
};
