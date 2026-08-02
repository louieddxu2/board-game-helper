import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../context/SessionContext';
import type { ContributionGameSummary, ContributionReviewStatus, ContributionRuleSummary, ContributionsPayload } from '../shared/types';

const reviewLabel = (status: ContributionReviewStatus, reviewer?: string) => {
  if (status === 'pending') return '未審核';
  if (status === 'reviewed') return reviewer ? `審核：${reviewer}` : '已審核';
  return '已建立';
};

const RuleItem = ({ rule }: { rule: ContributionRuleSummary }) => (
  <li className="contribution-item">
    <Link to={`/games/${rule.gameSlug}#rule-${rule.id}`}><strong>{rule.gameName}</strong><span>{rule.statement}</span></Link>
    <small>{reviewLabel(rule.reviewStatus, rule.reviewedByNickname)}</small>
  </li>
);

const GameItem = ({ game }: { game: ContributionGameSummary }) => (
  <li className="contribution-item">
    <Link to={`/games/${game.slug}`}><strong>{game.displayName}</strong></Link>
    <small>{game.mergedIntoGameId ? '已合併' : game.visibility === 'hidden' ? '已隱藏' : reviewLabel(game.reviewStatus, game.reviewedByNickname)}</small>
  </li>
);

export const ContributionsPage = () => {
  const { user, loading, canEdit } = useSession();
  const [data, setData] = useState<ContributionsPayload>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || canEdit) { setData(undefined); return; }
    let active = true;
    setError('');
    void api.contributions().then((payload) => { if (active) setData(payload); }).catch(() => {
      if (active) setError('暫時無法讀取投稿狀態，請稍後再試。');
    });
    return () => { active = false; };
  }, [user?.id, canEdit]);

  if (loading) return <section className="contributions-page narrow-page"><p className="muted">正在讀取投稿資訊…</p></section>;
  if (canEdit) return <Navigate to="/add" replace />;

  if (!user) return <section className="contributions-page narrow-page">
    <section className="account-card contribution-login">
      <h2>使用Google帳戶登入後即可填寫</h2>
      <p>登入後可有限度地建立規則。</p>
      <Link className="button primary" to="/login">登入</Link>
    </section>
  </section>;

  return <section className="contributions-page narrow-page">
    <header>
      <p className="eyebrow">投稿說明</p>
      <h1>投稿狀態與權限</h1>
      <p>一般登入帳號可使用完整填寫介面投稿；投稿會公開顯示，並由 Editor 或 Admin 審核。</p>
    </header>

    {data && <section className="account-card contribution-quota">
        <h2>目前投稿額度</h2>
        <div><strong>未審核規則 {data.quota.pendingRules} / {data.quota.ruleLimit}</strong><span>可再投稿 {data.quota.remainingRules} 條</span></div>
        <div><strong>未審核遊戲 {data.quota.pendingGames} / {data.quota.gameLimit}</strong><span>可再建立 {data.quota.remainingGames} 款</span></div>
    </section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!data && !error && <p className="muted">正在讀取投稿狀態…</p>}
    {data && <div className="contribution-sections">
      <section className="account-card">
        <div className="account-section-heading"><h2>我的規則投稿</h2><span>{data.rules.length} 條</span></div>
        {data.rules.length ? <ul className="account-list">{data.rules.map((rule) => <RuleItem key={rule.id} rule={rule} />)}</ul> : <p className="muted">尚無規則投稿。</p>}
      </section>
      <section className="account-card">
        <div className="account-section-heading"><h2>我建立的遊戲</h2><span>{data.games.length} 款</span></div>
        {data.games.length ? <ul className="account-list">{data.games.map((game) => <GameItem key={game.id} game={game} />)}</ul> : <p className="muted">尚無建立的遊戲。</p>}
      </section>
    </div>}

    <section className="account-card contribution-help">
      <h2>如何申請完整的編輯/審核權限？</h2>
      <p>若你願意協助校對投稿、整理遊戲或維護既有規則，請透過 <a href="https://www.facebook.com/huang.shao.dong.238497" target="_blank" rel="noopener noreferrer">黃紹東的 Facebook</a> 聯絡管理員。</p>
      <ol className="contribution-application-list">
        <li>請向管理員說明你希望申請完整的編輯／審核權限；公開暱稱可在取得權限後、實際參與審核前再設定。</li>
        <li>請附上既有投稿，或簡短說明你熟悉、願意協助維護的遊戲與規則資料。</li>
        <li>審核工作需要比對規則書與來源；若資料有爭議，會優先保留可追溯的來源與討論空間。</li>
      </ol>
      <p>取得完整權限後，仍使用相同的填寫介面，但不受一般投稿額度限制，也可以審核一般使用者的投稿。</p>
    </section>
  </section>;
};
