import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdSlot } from '../components/AdSlot';
import { GameSearch } from '../components/GameSearch';
import { RuleCard } from '../components/RuleCard';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import { hydrateRuleTags } from '../lib/tagHydration';
import type { HomePayload, RuleCard as RuleCardModel } from '../shared/types';

const HOME_CACHE_FRESH_MS = 60 * 60 * 1000;

export const HomePage = () => {
  const navigate = useNavigate();
  const { canEdit } = useSession();
  const [home, setHome] = useState<HomePayload>();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ game?: { displayName: string }; rules: Array<unknown> }>();
  const [recentGames, setRecentGames] = useState<Array<{ id: string; slug: string; displayName: string }>>([]);
  const [resolvedCards, setResolvedCards] = useState<(RuleCardModel & { gameName: string; gameSlug: string })[]>([]);
  const [resolvedRecentCards, setResolvedRecentCards] = useState<(RuleCardModel & { gameName: string; gameSlug: string })[]>([]);

  useEffect(() => {
    let active = true;
    const refreshHome = () => api.home().then((data) => {
      if (active) setHome(data);
      void localDb.cacheHome(data);
      if (data.popularGameIds) {
        void localDb.cacheHomeIDs({
          generatedAt: data.generatedAt,
          popularGameIds: data.popularGameIds,
          recentRuleIds: data.recentRuleIds ?? [],
          featuredRuleIds: data.featuredRuleIds ?? [],
        });
      }
      return data;
    }).catch(() => undefined);
    void localDb.getCachedHomeIDs().then((cachedIds) => {
      if (!active) return;
      if (cachedIds && (Date.now() - cachedIds.cachedAt < HOME_CACHE_FRESH_MS)) {
        // Fast ID-only initialization
      }
    });
    void localDb.getCachedHome().then((cached) => {
      if (!active) return;
      if (cached) setHome(cached.data);
      if (!cached || Date.now() - cached.cachedAt >= HOME_CACHE_FRESH_MS) void refreshHome();
    }).catch(() => { void refreshHome(); });
    void localDb.getDraft().then((value) => { if (active && value && value.rules.some((rule) => rule.statement)) setDraft(value); });
    void localDb.recentGames().then((games) => { if (active) setRecentGames(games); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!home?.featured?.length) return;
    let active = true;
    const resolve = async () => {
      const cards: (RuleCardModel & { gameName: string; gameSlug: string })[] = [];
      for (const ref of home.featured) {
        if (!ref?.ruleId) continue;
        try {
          const cached = await localDb.getCachedRuleEntity(ref.ruleId);
          if (cached?.data) {
            cards.push({ ...cached.data, gameName: ref.gameName, gameSlug: ref.gameSlug });
          } else {
            const response = await api.rule(ref.ruleId);
            const rule = response?.rule;
            if (rule) {
              cards.push({ ...rule, gameName: ref.gameName, gameSlug: ref.gameSlug });
            }
          }
        } catch { /* skip failed rules */ }
      }
      const hydratedCards = await hydrateRuleTags(cards);
      await Promise.all(hydratedCards.map((rule) => localDb.cacheRuleEntity(rule)));
      if (active) setResolvedCards(hydratedCards);
    };
    void resolve();
    return () => { active = false; };
  }, [home?.featured]);

  useEffect(() => {
    if (!home?.recentRuleIds?.length && !home?.recentRules?.length) return;
    if (home.recentRules?.length) {
      setResolvedRecentCards(home.recentRules);
      return;
    }
    let active = true;
    const resolve = async () => {
      const cards: (RuleCardModel & { gameName: string; gameSlug: string })[] = [];
      for (const ruleId of home.recentRuleIds!) {
        if (!ruleId) continue;
        try {
          const cached = await localDb.getCachedRuleEntity(ruleId);
          const cachedGameName = (cached?.data as any)?.gameName;
          const cachedGameSlug = (cached?.data as any)?.gameSlug;
          if (cached?.data && cachedGameName && cachedGameSlug) {
            cards.push({ ...cached.data, gameName: cachedGameName, gameSlug: cachedGameSlug });
          } else {
            const response = await api.rule(ruleId);
            const rule = response?.rule;
            if (rule) {
              cards.push({ ...rule, gameName: rule.gameName ?? '', gameSlug: rule.gameSlug ?? '' });
            }
          }
        } catch { /* skip failed rules */ }
      }
      const hydratedCards = await hydrateRuleTags(cards);
      await Promise.all(hydratedCards.map((rule) => localDb.cacheRuleEntity(rule)));
      if (active) setResolvedRecentCards(hydratedCards);
    };
    void resolve();
    return () => { active = false; };
  }, [home?.recentRuleIds, home?.recentRules]);

  const displayedFeaturedRules = resolvedCards.length > 0 ? resolvedCards : (home?.featuredRules ?? []);

  return <>
    <section className="hero">
      <div className="hero-inner"><div className="hero-main">
        <h1>這次玩對，或是下次玩對。</h1>
        <div className="hero-search" id="home-search"><GameSearch value={query} onChange={setQuery} onSelect={(game) => navigate(`/games/${game.slug}`)} onRuleSelect={(rule) => navigate(`/games/${rule.gameSlug}?find=${encodeURIComponent(query)}#rule-${rule.ruleId}`)} allowCreate onCreate={canEdit ? (name) => { navigate(`/add?name=${encodeURIComponent(name)}`); } : undefined} /></div>
        {recentGames.length > 0 && <div className="hero-recents"><span>最近看過</span><div className="hero-recents-list">{recentGames.slice(0, 5).map((game) => <Link key={game.id} to={`/games/${game.slug}`}>{game.displayName}</Link>)}</div></div>}
      </div>
      </div>
    </section>
    {draft && canEdit && <section className="draft-banner">
      <div><small>未完成草稿</small><strong>{draft.game?.displayName ?? '尚未選擇遊戲'}・{draft.rules.length} 個輸入格</strong></div>
      <Link to="/add">繼續記錄 →</Link>
    </section>}
    <section id="discover" className="content-section">
      <div className="section-heading"><div><h2>近期常被查閱的遊戲/規則</h2></div></div>
      <div className="rule-grid">
        {displayedFeaturedRules.map((rule) =>
          <RuleCard key={rule.id} rule={rule} gameId={(rule as any).gameId} gameName={rule.gameName} gameHref={`/games/${rule.gameSlug}`} onTagClick={(tag) => navigate(`/games/${rule.gameSlug}?tag=${encodeURIComponent(tag)}`)} />)}
        {!home && Array.from({ length: 3 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <div className="skeleton-line title" />
            <div className="skeleton-line" />
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
          </div>
        ))}
        {home && displayedFeaturedRules.length === 0 && <p className="empty-state">內容正在整理中。</p>}
      </div>
    </section>
    <AdSlot placement="home-after-game-exploration" />
    {resolvedRecentCards.length > 0 && <section className="content-section">
      <div className="section-heading"><div><h2>近期被玩錯的規則</h2></div></div>
      <div className="rule-grid compact">{resolvedRecentCards.map((rule) =>
        <RuleCard key={rule.id} rule={rule} gameName={rule.gameName} gameHref={`/games/${rule.gameSlug}`} onTagClick={(tag) => navigate(`/games/${rule.gameSlug}?tag=${encodeURIComponent(tag)}`)} />)}</div>
    </section>}
  </>;
};
