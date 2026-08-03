import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../context/SessionContext';
import type { ContributionGameSummary, ContributionRuleSummary, ContributionsPayload } from '../shared/types';

const RuleItem = ({ rule }: { rule: ContributionRuleSummary }) => (
  <li className="contribution-item">
    <Link to={`/games/${rule.gameSlug}#rule-${rule.id}`}><strong>{rule.gameName}</strong><span>{rule.statement}</span></Link>
    <small>未審核</small>
  </li>
);

const GameItem = ({ game }: { game: ContributionGameSummary }) => (
  <li className="contribution-item">
    <Link to={`/games/${game.slug}`}><strong>{game.displayName}</strong></Link>
    <small>{game.mergedIntoGameId ? '已合併' : game.visibility === 'hidden' ? '已隱藏' : '未審核'}</small>
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

  const pendingRules = data?.rules.filter((rule) => rule.reviewStatus !== 'reviewed') ?? [];
  const pendingGames = data?.games.filter((game) => game.reviewStatus !== 'reviewed') ?? [];

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
        <div className="account-section-heading"><h2>未審核規則</h2><span>{pendingRules.length} 條</span></div>
        {pendingRules.length ? <ul className="account-list">{pendingRules.map((rule) => <RuleItem key={rule.id} rule={rule} />)}</ul> : <p className="muted">目前沒有未審核規則。</p>}
      </section>
      <section className="account-card">
        <div className="account-section-heading"><h2>未審核遊戲</h2><span>{pendingGames.length} 款</span></div>
        {pendingGames.length ? <ul className="account-list">{pendingGames.map((game) => <GameItem key={game.id} game={game} />)}</ul> : <p className="muted">目前沒有未審核遊戲。</p>}
      </section>
    </div>}

    <section className="account-card contribution-help">
      <h2>如何申請完整的編輯/審核權限？</h2>
      <p>如果你平常也有記錄玩錯規則的習慣，覺得記錄在此網頁方便自用，且分享給大家也不錯，歡迎申請編輯權限：</p>
      <p>
        到Facebook上聯繫我：<a href="https://www.facebook.com/huang.shao.dong.238497" target="_blank" rel="noopener noreferrer">黃紹東</a><br />
        <span className="muted">或任何其他聯繫方式也行。</span>
      </p>
      <ol className="contribution-application-list">
        <li>提供你的Gmail帳號，我授權之後你登入就會獲得權限。</li>
        <li>提供一筆你此刻想添加的規則內容，我會用我的標準評估文字表達能力來決定是否授權，或者說評估心態上的嚴謹程度。</li>
        <li>或是如果你有經營桌遊相關的部落格、粉絲專頁、Youtube等等，我大概會直接授權(因為這表示你有基礎的文字表達能力，並且會顧及自身的聲望)；或是我認識你，了解你的文字表達能力/嚴謹程度可以信任，那或許也行。</li>
      </ol>
      <p className="muted">白話來說，讓我確定你是善意、穩定的使用者。</p>
    </section>
  </section>;
};
