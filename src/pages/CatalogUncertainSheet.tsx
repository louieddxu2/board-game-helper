import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { uncertainRulesApi } from '../lib/uncertainRulesApi';
import type { UncertainRule } from '../shared/types';

/** An expanded game's uncertain questions in the uncertain mode, as compact rows like its rules; a tap opens the game page. */
export const CatalogUncertainSheet = ({ gameId, slug }: { gameId: string; slug: string }) => {
  const [rules, setRules] = useState<UncertainRule[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setRules(undefined);
    setFailed(false);
    uncertainRulesApi.list(gameId).then((response) => { if (active) setRules(response.uncertainRules); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [gameId]);
  if (failed) return <p className="catalog-loading" role="alert">這個遊戲的不確定規則載入失敗，請再試一次。</p>;
  if (!rules) return <p className="catalog-loading">正在載入不確定的規則…</p>;
  return <div className="catalog-detail-wrap">
    {rules.length === 0 ? <p className="catalog-rules-empty">這款遊戲沒有不確定的規則。</p> : <ul className="catalog-rule-list">
      {rules.map((rule) => <li key={rule.id}><Link to={`/games/${slug}`}>
        <span className="catalog-rule-text">{rule.question}</span>
        <span className={rule.checkedAt === null ? 'catalog-status catalog-status-draft' : 'catalog-status catalog-status-published'}>{rule.checkedAt === null ? '沒查過BGG' : '已查過BGG無答案'}</span>
      </Link></li>)}
    </ul>}
  </div>;
};
