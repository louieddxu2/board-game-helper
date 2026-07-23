import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdSlot } from '../components/AdSlot';
import { GameSearch } from '../components/GameSearch';
import { RuleCard } from '../components/RuleCard';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import type { HomePayload } from '../shared/types';

export const HomePage = () => {
  const navigate = useNavigate();
  const { canEdit } = useSession();
  const [home, setHome] = useState<HomePayload>();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ game?: { displayName: string }; rules: Array<unknown> }>();
  const [recentGames, setRecentGames] = useState<Array<{ id: string; slug: string; displayName: string }>>([]);
  useEffect(() => {
    let active = true;
    void localDb.getCachedHome().then((cached) => { if (active && cached) setHome(cached.data); });
    void api.home().then((data) => {
      if (active) setHome(data);
      return localDb.cacheHome(data);
    }).catch(() => undefined);
    void localDb.getDraft().then((value) => { if (active && value && value.rules.some((rule) => rule.statement)) setDraft(value); });
    void localDb.recentGames().then((games) => { if (active) setRecentGames(games); });
    return () => { active = false; };
  }, []);
  return <>
    <section className="hero">
      <div className="hero-inner"><div className="hero-main"><p className="eyebrow">桌邊的錯誤記憶庫</p>
        <h1>這次玩對，<br />或是下次玩對。</h1>
        <p className="hero-copy">不重寫整本說明書，只留下真正讓玩家踩過坑的規則。開桌前花半分鐘，少玩錯一整場。</p>
        <div className="hero-actions">
          {canEdit ? <Link className="button primary" to="/add">記錄玩錯規則</Link> : <Link className="button primary" to="/login">登入後記錄</Link>}
          <a className="button secondary" href="#discover">瀏覽真實紀錄</a>
        </div>
        <div className="hero-search" id="home-search"><GameSearch includeRules value={query} onChange={setQuery} onSelect={(game) => navigate(`/games/${game.slug}`)} onRuleSelect={(rule) => navigate(`/games/${rule.gameSlug}?find=${encodeURIComponent(query)}#rule-${rule.ruleId}`)} /></div>
        {recentGames.length > 0 && <div className="hero-recents"><span>最近看過</span>{recentGames.slice(0, 4).map((game) => <Link key={game.id} to={`/games/${game.slug}`}>{game.displayName}</Link>)}</div>}
      </div>
      {home?.featuredRules[0] && <aside className="hero-preview"><p className="eyebrow">一張卡就看懂</p><RuleCard rule={home.featuredRules[0]} gameName={home.featuredRules[0].gameName} gameHref={`/games/${home.featuredRules[0].gameSlug}`} /></aside>}
      </div>
    </section>
    {draft && canEdit && <section className="draft-banner">
      <div><small>未完成草稿</small><strong>{draft.game?.displayName ?? '尚未選擇遊戲'}・{draft.rules.length} 個輸入格</strong></div>
      <Link to="/add">繼續記錄 →</Link>
    </section>}
    <section id="discover" className="content-section">
      <div className="section-heading"><div><p className="eyebrow">一看就懂</p><h2>大家真的玩錯過這些</h2></div></div>
      <div className="rule-grid">
        {(home?.featuredRules.length ? home.featuredRules : home?.recentRules ?? []).slice(0, 10).map((rule) =>
          <RuleCard key={rule.id} rule={rule} gameName={rule.gameName} gameHref={`/games/${rule.gameSlug}`} />)}
        {!home && <p className="loading-card">載入規則中…</p>}
        {home && home.featuredRules.length === 0 && home.recentRules.length === 0 && <p className="empty-state">內容正在整理中。登入後可以先從第一款遊戲開始記錄。</p>}
      </div>
    </section>
    {home && home.popularGames.length > 0 && <Fragment><section className="content-section game-section">
      <div className="section-heading"><div><p className="eyebrow">依遊戲探索</p><h2>規則紀錄較多的遊戲</h2></div></div>
      <div className="game-grid">{home.popularGames.map((game) => <Link to={`/games/${game.slug}`} key={game.id}>
        <strong>{game.displayName}</strong>{game.englishName && <span>{game.englishName}</span>}<small>{game.ruleCount} 條踩雷紀錄 →</small>
      </Link>)}</div>
    </section><AdSlot placement="home-after-game-exploration" /></Fragment>}
    {home && home.recentRules.length > 0 && <section className="content-section">
      <div className="section-heading"><div><p className="eyebrow">最近新增</p><h2>剛被記住的錯誤</h2></div></div>
      <div className="rule-grid compact">{home.recentRules.map((rule) =>
        <RuleCard key={rule.id} rule={rule} gameName={rule.gameName} gameHref={`/games/${rule.gameSlug}`} />)}</div>
    </section>}
  </>;
};
