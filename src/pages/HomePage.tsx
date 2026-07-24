import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdSlot } from '../components/AdSlot';
import { GameSearch } from '../components/GameSearch';
import { RuleCard } from '../components/RuleCard';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import type { HomePayload } from '../shared/types';

const HOME_CACHE_FRESH_MS = 5 * 60 * 1000;

export const HomePage = () => {
  const navigate = useNavigate();
  const { canEdit } = useSession();
  const [home, setHome] = useState<HomePayload>();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ game?: { displayName: string }; rules: Array<unknown> }>();
  const [recentGames, setRecentGames] = useState<Array<{ id: string; slug: string; displayName: string }>>([]);
  useEffect(() => {
    let active = true;
    const refreshHome = () => api.home().then((data) => {
      if (active) setHome(data);
      return localDb.cacheHome(data);
    }).catch(() => undefined);
    void localDb.getCachedHome().then((cached) => {
      if (!active) return;
      if (cached) setHome(cached.data);
      if (!cached || Date.now() - cached.cachedAt >= HOME_CACHE_FRESH_MS) void refreshHome();
    }).catch(() => { void refreshHome(); });
    void localDb.getDraft().then((value) => { if (active && value && value.rules.some((rule) => rule.statement)) setDraft(value); });
    void localDb.recentGames().then((games) => { if (active) setRecentGames(games); });
    return () => { active = false; };
  }, []);
  return <>
    <section className="hero">
      <div className="hero-inner"><div className="hero-main">
        <h1>這次玩對，<br />或是下次玩對。</h1>
        <div className="hero-search" id="home-search"><GameSearch includeRules value={query} onChange={setQuery} onSelect={(game) => navigate(`/games/${game.slug}`)} onRuleSelect={(rule) => navigate(`/games/${rule.gameSlug}?find=${encodeURIComponent(query)}#rule-${rule.ruleId}`)} allowCreate onCreate={(name) => { navigate(canEdit ? `/add?name=${encodeURIComponent(name)}` : '/login'); }} /></div>
        {recentGames.length > 0 && <div className="hero-recents"><span>最近看過</span>{recentGames.slice(0, 4).map((game) => <Link key={game.id} to={`/games/${game.slug}`}>{game.displayName}</Link>)}</div>}
      </div>
      </div>
    </section>
    {draft && canEdit && <section className="draft-banner">
      <div><small>未完成草稿</small><strong>{draft.game?.displayName ?? '尚未選擇遊戲'}・{draft.rules.length} 個輸入格</strong></div>
      <Link to="/add">繼續記錄 →</Link>
    </section>}
    {home && home.popularGames.length > 0 && <Fragment><section className="content-section game-section">
      <div className="section-heading"><div><h2>近 7 天常被查閱的遊戲</h2></div></div>
      <div className="game-grid">{home.popularGames.map((game) => <Link to={`/games/${game.slug}`} key={game.id}>
        <strong>{game.displayName}</strong>{game.englishName && <span>{game.englishName}</span>}<small>{game.ruleCount} 條規則紀錄 →</small>
      </Link>)}</div>
    </section><AdSlot placement="home-after-game-exploration" /></Fragment>}
    <section id="discover" className="content-section">
      <div className="section-heading"><div><h2>勘誤與易錯規則紀錄</h2></div></div>
      <div className="rule-grid">
        {(home?.featuredRules.length ? home.featuredRules : home?.recentRules ?? []).slice(0, 10).map((rule) =>
          <RuleCard key={rule.id} rule={rule} gameName={rule.gameName} gameHref={`/games/${rule.gameSlug}`} />)}
        {!home && Array.from({ length: 3 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <div className="skeleton-line title" />
            <div className="skeleton-line" />
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
          </div>
        ))}
        {home && home.featuredRules.length === 0 && home.recentRules.length === 0 && <p className="empty-state">內容正在整理中。登入後可以先從第一款遊戲開始記錄。</p>}
      </div>
    </section>
    {home && home.recentRules.length > 0 && <section className="content-section">
      <div className="section-heading"><div><h2>近期被玩錯的規則</h2></div></div>
      <div className="rule-grid compact">{home.recentRules.map((rule) =>
        <RuleCard key={rule.id} rule={rule} gameName={rule.gameName} gameHref={`/games/${rule.gameSlug}`} />)}</div>
    </section>}
  </>;
};
