import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdSlot } from '../components/AdSlot';
import { GameSearch } from '../components/GameSearch';
import { RuleCard } from '../components/RuleCard';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { homeContentKey } from '../lib/homeCache';
import { localDb } from '../lib/localDb';
import { hydrateRuleTags } from '../lib/tagHydration';
import { PersonalHomeCard } from '../components/PersonalHomeCard';
import { readHomeMode, resolveHomeMode, writeHomeMode, type HomeMode } from '../lib/homeMode';
import type { HomePayload, PersonalHomePayload, RuleCard as RuleCardModel } from '../shared/types';

const ExploreHome = ({ onShowPersonal }: { onShowPersonal?: () => void }) => {
  const navigate = useNavigate();
  const { canEdit } = useSession();
  const [home, setHome] = useState<HomePayload>();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ game?: { displayName: string }; rules: Array<unknown> }>();
  const [recentGames, setRecentGames] = useState<Array<{ id: string; slug: string; displayName: string }>>([]);
  const [resolvedCards, setResolvedCards] = useState<(RuleCardModel & { gameName: string; gameSlug: string })[]>([]);
  const [resolvedRecentCards, setResolvedRecentCards] = useState<(RuleCardModel & { gameName: string; gameSlug: string })[]>([]);
  const [resolvingHome, setResolvingHome] = useState(false);
  const homeGeneratedAt = useRef(0);
  const homeKey = useRef('');

  useEffect(() => {
    let active = true;
    const adoptHome = (data: HomePayload, rendered = false) => {
      if (!active || data.generatedAt < homeGeneratedAt.current) return;
      const nextKey = homeContentKey(data);
      homeGeneratedAt.current = data.generatedAt;
      if (nextKey === homeKey.current) return;
      homeKey.current = nextKey;
      setHome(data);
      if (rendered) {
        setResolvedCards(data.featuredRules ?? []);
        setResolvedRecentCards(data.recentRules ?? []);
      }
    };
    void (async () => {
      const rendered = await localDb.getLatestHomeView().catch(() => undefined);
      if (rendered) adoptHome(rendered.data, true);
      const current = await api.home((updated) => adoptHome(updated));
      adoptHome(current);
    })().catch(() => undefined);
    void localDb.getDraft().then((value) => { if (active && value && value.rules.some((rule) => rule.statement)) setDraft(value); });
    void localDb.recentGames().then((games) => { if (active) setRecentGames(games); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!home) return;
    let active = true;
    setResolvingHome(true);
    const resolveFeatured = async () => {
      if (home.featuredRules?.length) return hydrateRuleTags(home.featuredRules);
      const rules: (RuleCardModel & { gameName: string; gameSlug: string })[] = [];
      for (const ref of home.featured ?? []) {
        if (ref?.ruleId) {
          try {
            const rule = (await api.rule(ref.ruleId, (updated) => {
              void hydrateRuleTags([{ ...updated.rule, gameName: ref.gameName, gameSlug: ref.gameSlug }]).then(([hydrated]) => {
                if (active) setResolvedCards((current) => current.map((item) => item.id === hydrated.id ? hydrated : item));
              });
            }))?.rule;
            if (rule) rules.push({ ...rule, gameName: ref.gameName, gameSlug: ref.gameSlug });
          } catch { /* retain the previous rendered snapshot while unavailable */ }
        }
      }
      return hydrateRuleTags(rules);
    };
    const resolveRecent = async () => {
      if (home.recentRules?.length) return hydrateRuleTags(home.recentRules);
      const rules: (RuleCardModel & { gameName: string; gameSlug: string })[] = [];
      for (const ruleId of home.recentRuleIds ?? []) {
        if (ruleId) {
          try {
            const rule = (await api.rule(ruleId, (updated) => {
              void hydrateRuleTags([{ ...updated.rule, gameName: updated.rule.gameName ?? '', gameSlug: updated.rule.gameSlug ?? '' }]).then(([hydrated]) => {
                if (active) setResolvedRecentCards((current) => current.map((item) => item.id === hydrated.id ? hydrated : item));
              });
            }))?.rule;
            if (rule) rules.push({ ...rule, gameName: rule.gameName ?? '', gameSlug: rule.gameSlug ?? '' });
          } catch { /* retain the previous rendered snapshot while unavailable */ }
        }
      }
      return hydrateRuleTags(rules);
    };
    void Promise.all([resolveFeatured(), resolveRecent()]).then(async ([featuredRules, recentRules]) => {
      if (!active) return;
      const expectedFeatured = (home.featured ?? []).filter((ref) => ref.ruleId).length || home.featuredRules?.length || 0;
      const expectedRecent = home.recentRules?.length || (home.recentRuleIds ?? []).filter(Boolean).length;
      const featuredComplete = featuredRules.length === expectedFeatured;
      const recentComplete = recentRules.length === expectedRecent;
      if (featuredComplete) setResolvedCards(featuredRules);
      if (recentComplete) setResolvedRecentCards(recentRules);
      await Promise.all([...featuredRules, ...recentRules].map((rule) => localDb.cacheRuleEntity(rule)));
      if (featuredComplete && recentComplete) await localDb.cacheHomeView({ ...home, featuredRules, recentRules });
    }).catch(() => undefined).finally(() => { if (active) setResolvingHome(false); });
    return () => { active = false; };
  }, [home]);

  const displayedFeaturedRules = resolvedCards.length > 0 ? resolvedCards : (home?.featuredRules ?? []);

  return <>
    <section className="hero">
      <div className="hero-bg" aria-hidden="true" />
      {onShowPersonal && <button type="button" className="home-mode-button explore-mode-button" onClick={onShowPersonal}>我的收藏</button>}
      <div className="hero-inner"><div className="hero-main">
        <h1>這次玩對，或是下次玩對。</h1>
        <div className="hero-search" id="home-search"><GameSearch value={query} onChange={setQuery} onSelect={(game) => navigate(`/games/${game.slug}`)} onRuleSelect={(rule) => navigate(`/games/${rule.gameSlug}?find=${encodeURIComponent(query)}#rule-${rule.ruleId}`)} allowCreate onCreate={canEdit ? (name) => { navigate(`/add?name=${encodeURIComponent(name)}`); } : undefined} /></div>
        {recentGames.length > 0 && <div className="hero-recents"><span>最近看過</span><div className="hero-recents-list">{recentGames.slice(0, 6).map((game) => <Link key={game.id} to={`/games/${game.slug}`}>{game.displayName}</Link>)}</div></div>}
      </div>
      </div>
    </section>
    {draft && canEdit && <section className="draft-banner">
      <div><small>未完成草稿</small><strong>{draft.game?.displayName ?? '尚未選擇遊戲'}・{draft.rules.length} 個輸入格</strong></div>
      <Link to="/add">繼續記錄 →</Link>
    </section>}
    <section id="discover" className="content-section">
      <div className="section-heading"><div><h2>近期常被查閱的遊戲</h2></div></div>
      <div className="rule-grid">
        {displayedFeaturedRules.map((rule) =>
          <RuleCard key={rule.id} rule={rule} gameName={rule.gameName} gameHref={`/games/${rule.gameSlug}`} onTagClick={(tag) => navigate(`/games/${rule.gameSlug}?tag=${encodeURIComponent(tag)}`)} />)}
        {!home && Array.from({ length: 3 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <div className="skeleton-line title" />
            <div className="skeleton-line" />
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
          </div>
        ))}
        {home && resolvingHome && displayedFeaturedRules.length === 0 && Array.from({ length: 3 }, (_, index) => (
          <div className="skeleton-card" key={`resolving-${index}`}>
            <div className="skeleton-line title" />
            <div className="skeleton-line" />
            <div className="skeleton-line medium" />
          </div>
        ))}
        {home && !resolvingHome && displayedFeaturedRules.length === 0 && <p className="empty-state">內容正在整理中。</p>}
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

const PersonalHome = ({ data, onShowExplore }: { data: PersonalHomePayload; onShowExplore(): void }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [recentGames, setRecentGames] = useState<Array<{ id: string; slug: string; displayName: string }>>([]);

  useEffect(() => {
    let active = true;
    void localDb.recentGames().then((games) => { if (active) setRecentGames(games); });
    return () => { active = false; };
  }, []);

  return <div className="personal-home">
    <section className="personal-home-hero">
      <div className="personal-home-hero-bg" aria-hidden="true" />
      <div className="personal-home-search">
      <div className="personal-home-toolbar">
        <h1>我的桌遊</h1>
        <button type="button" className="home-mode-button" onClick={onShowExplore}>探索</button>
      </div>
      <GameSearch value={query} onChange={setQuery} includeRules
        onSelect={(game) => navigate(`/games/${game.slug}`)}
        onRuleSelect={(rule) => navigate(`/games/${rule.gameSlug}?find=${encodeURIComponent(query)}#rule-${rule.ruleId}`)} />
      {recentGames.length > 0 && <div className="personal-home-recents">
        <div>{recentGames.slice(0, 6).map((game) => <Link key={game.id} to={`/games/${game.slug}`}>{game.displayName}</Link>)}</div>
      </div>}
      </div>
    </section>

    <div className="personal-home-content">
      <section className="personal-home-section" aria-labelledby="favorite-games-heading">
        <div className="personal-home-heading"><h2 id="favorite-games-heading">我的收藏</h2><span>{data.favorites.length} / 6</span></div>
        {data.favorites.length > 0
          ? <div className="personal-home-grid">{data.favorites.map((game) => <PersonalHomeCard key={game.id} game={game} />)}</div>
          : <div className="personal-home-empty">
              <span className="personal-home-empty-icon" aria-hidden="true">☆</span>
              <div><strong>把常玩的遊戲放在這裡</strong><p>前往遊戲頁按下「收藏」，最多可以加入 6 款遊戲。</p></div>
              <button type="button" className="button secondary" onClick={onShowExplore}>探索遊戲</button>
            </div>}
      </section>
    </div>

    <AdSlot placement="personal-home-after-favorites" />

    {data.recentUpdates.length > 0 && <div className="personal-home-content"><section className="personal-home-section" aria-labelledby="recent-updates-heading">
      <div className="personal-home-heading"><h2 id="recent-updates-heading">近期新增與修改</h2><span>規則動態</span></div>
      <div className="personal-home-grid">{data.recentUpdates.map((game) => <PersonalHomeCard key={game.id} game={game} />)}</div>
    </section></div>}
  </div>;
};

export const HomePage = () => {
  const { user, loading } = useSession();
  const [personalHome, setPersonalHome] = useState<PersonalHomePayload>();
  const [mode, setMode] = useState<HomeMode>('explore');

  useEffect(() => {
    if (!user) {
      setPersonalHome(undefined);
      setMode('explore');
      return;
    }
    let active = true;
    void api.personalHome().then((data) => {
      if (!active) return;
      setPersonalHome(data);
      const resolved = resolveHomeMode(data.favorites.length, readHomeMode());
      setMode(resolved);
    }).catch(() => {
      if (active) {
        setPersonalHome(undefined);
        setMode('explore');
      }
    });
    return () => { active = false; };
  }, [user]);

  const selectMode = (nextMode: HomeMode) => {
    writeHomeMode(nextMode);
    setMode(nextMode);
  };

  if (!loading && user && personalHome && mode === 'personal') {
    return <PersonalHome data={personalHome!} onShowExplore={() => selectMode('explore')} />;
  }
  return <ExploreHome onShowPersonal={user && personalHome ? () => selectMode('personal') : undefined} />;
};
