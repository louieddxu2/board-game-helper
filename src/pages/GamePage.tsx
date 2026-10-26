import { Fragment, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { FavoriteLimitDialog } from '../components/FavoriteLimitDialog';
import { clearSearchCache } from '../components/GameSearch';
import { CompactRuleCard, RuleCard } from '../components/RuleCard';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../lib/api';
import { getRuleEditions } from '../lib/editionOptions';
import { writeHomeMode } from '../lib/homeMode';
import { localDb } from '../lib/localDb';
import { effectiveRuleCategories, filterRulesByCategory } from '../lib/ruleCategories';
import { applyRuleImportance, sortRulesByImportance, updateRuleImportanceCount } from '../lib/ruleImportance';
import { canUserEditRule } from '../lib/rulePermissions';
import { hydrateGameTags, hydrateRuleTags } from '../lib/tagHydration';
import type { PersonalHomeGame } from '../shared/types';
import { RULE_CATEGORIES, RULE_CATEGORY_LABELS, type GameDetail, type RuleCard as RuleCardType, type RuleCategory, type TagSummary } from '../shared/types';
import { ExternalResourcesDialog, GameEditor, RuleEditor } from './GamePageDialogs';

const estimateTitleWidthUnits = (title: string) => Math.max(8, Math.ceil(Array.from(title).reduce((total, character) => (
  total + (character === ' ' ? 0.35 : character.charCodeAt(0) <= 0x7f ? 0.6 : 1)
), 0)));

export const GamePage = () => {
  const { identifier = '' } = useParams();
  const location = useLocation();
  const { canEdit, user, isAdmin } = useSession();
  const canEditRule = (rule: RuleCardType) => canUserEditRule(rule, user, isAdmin);
  const { showToast } = useToast();
  const [activeCategory, setActiveCategory] = useState<'all' | RuleCategory>(() => {
    const category = new URLSearchParams(location.search).get('category');
    return RULE_CATEGORIES.includes(category as RuleCategory) ? category as RuleCategory : 'all';
  });
  const [game, setGame] = useState<GameDetail>();
  const [classificationTags, setClassificationTags] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RuleCardType>();
  const [editingGame, setEditingGame] = useState(false);
  const [externalResourcesOpen, setExternalResourcesOpen] = useState(false);
  const [favorite, setFavorite] = useState<boolean>();
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [favoriteLimitGames, setFavoriteLimitGames] = useState<PersonalHomeGame[]>();
  const [removingFavoriteId, setRemovingFavoriteId] = useState<string>();
  const [importantRuleIds, setImportantRuleIds] = useState<string[]>([]);
  const [importanceReady, setImportanceReady] = useState(false);
  const [importanceSaving, setImportanceSaving] = useState<Set<string>>(new Set());
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const handledRuleHash = useRef<string | undefined>(undefined);
  const [activePlayerCounts, setActivePlayerCounts] = useState<number[]>([]);
  const [activeEditions, setActiveEditions] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>(() => {
    const searchParams = new URLSearchParams(location.search);
    const tagParam = searchParams.get('tag') || searchParams.get('tags');
    return tagParam ? tagParam.split(',').map((t) => t.trim()).filter(Boolean) : [];
  });

  const toggleTag = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };
  const togglePlayerCount = (count: number) => {
    setActivePlayerCounts((prev) =>
      prev.includes(count) ? prev.filter((c) => c !== count) : [...prev, count]
    );
  };
  const togglePlayerCounts = (counts: number[]) => {
    const uniqueCounts = Array.from(new Set(counts));
    if (uniqueCounts.length === 0) return;
    setActivePlayerCounts((prev) => {
      const allSelected = uniqueCounts.every((count) => prev.includes(count));
      return allSelected
        ? prev.filter((count) => !uniqueCounts.includes(count))
        : Array.from(new Set([...prev, ...uniqueCounts]));
    });
  };
  const toggleEdition = (edition: string) => {
    setActiveEditions((prev) =>
      prev.includes(edition) ? prev.filter((e) => e !== edition) : [...prev, edition]
    );
  };
  const clearAllFilters = () => {
    setActiveTags([]);
    setActivePlayerCounts([]);
    setActiveEditions([]);
    setRuleQuery('');
  };

  const beginRuleEdit = async (rule: RuleCardType) => {
    const ordinary = Boolean(user && !user.roles.some((role) => role === 'editor' || role === 'admin'));
    const openLatestRule = async () => {
      try {
        const latestResponse = await api.ruleFresh(rule.id);
        const [latestRule] = await hydrateRuleTags([latestResponse]);
        setGame((current) => current ? {
          ...current,
          rules: current.rules.map((candidate) => candidate.id === latestRule.id ? latestRule : candidate),
        } : current);
        setEditing(latestRule);
      } catch {
        // Keep the cached page usable when the refresh is unavailable. The
        // server-side optimistic concurrency check still protects the save.
        setEditing(rule);
      }
    };
    if (!ordinary || rule.reviewStatus === 'pending') {
      await openLatestRule();
      return;
    }
    try {
      const { quota } = await api.contributions();
      if (quota.remainingRules < 1) {
        showToast('待審核額度已用完，無法修改這條規則。', 'info');
        return;
      }
      await openLatestRule();
    } catch {
      showToast('暫時無法確認待審核額度，請稍後再試。', 'error');
    }
  };

  const [ruleQuery, setRuleQuery] = useState(() => new URLSearchParams(location.search).get('find') ?? '');
  const load = async () => {
    try {
      const response = await api.game(identifier, false, (updated) => {
        void hydrateGameTags(updated.game).then(setGame);
      });
      const hydratedGame = await hydrateGameTags(response.game);
      setGame(hydratedGame);
    } finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    const justAdded = Boolean((location.state as { justAdded?: number } | null)?.justAdded);
    const applyUpdated = async (updated: { game: GameDetail }) => {
      const hydratedGame = await hydrateGameTags(updated.game);
      if (active) setGame(hydratedGame);
    };
    void (justAdded ? localDb.invalidateGame(identifier) : Promise.resolve()).then(() => api.game(identifier, false, (updated) => { void applyUpdated(updated); })).then(async (response) => {
      const hydratedGame = await hydrateGameTags(response.game);
      if (active) setGame(hydratedGame);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identifier, location.state]);
  useEffect(() => {
    setExpandedRuleId(null);
    setEditing(undefined);
    setEditingGame(false);
    setExternalResourcesOpen(false);
    setFavoriteLimitGames(undefined);
    setRemovingFavoriteId(undefined);
  }, [identifier]);
  useEffect(() => {
    let active = true;
    const applyTags = (data: { tags: TagSummary[] }) => { if (active) setClassificationTags(data.tags); };
    void api.tags(undefined, applyTags).then(applyTags).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!location.hash) {
      handledRuleHash.current = undefined;
      return;
    }
    if (!game || !location.hash.startsWith('#rule-')) return;
    const hashKey = `${game.id}:${location.hash}`;
    if (handledRuleHash.current === hashKey) return;
    handledRuleHash.current = hashKey;
    try {
      const ruleId = decodeURIComponent(location.hash.slice('#rule-'.length));
      if (game.rules.some((rule) => rule.id === ruleId)) setExpandedRuleId(ruleId);
    } catch {
      // Ignore malformed external hashes instead of crashing the page.
    }
  }, [game, location.hash]);
  useEffect(() => {
    if (!expandedRuleId) return;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`rule-${expandedRuleId}`);
      if (!element) return;
      const isMobile = window.matchMedia('(max-width: 800px)').matches;
      element.scrollIntoView({ behavior: 'smooth', block: isMobile ? 'center' : 'start' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expandedRuleId]);
  useEffect(() => {
    if (!game || !user) return;
    const today = new Date().toISOString().slice(0, 10);
    const storageKey = `viewed:game:${game.id}`;
    if (localStorage.getItem(storageKey) !== today) {
      void api.recordView(game.id)
        .then(() => localStorage.setItem(storageKey, today))
        .catch(() => undefined);
    }
  }, [game, user]);
  useEffect(() => {
    if (!game || !user) { setFavorite(undefined); return; }
    let active = true;
    setFavorite(undefined);
    void api.favoriteStatus(game.id).then((result) => {
      if (active) setFavorite(result.favorite);
    }).catch(() => { if (active) setFavorite(false); });
    return () => { active = false; };
  }, [game?.id, user?.id]);
  useEffect(() => {
    if (!game || !user || !favorite) return;
    void api.markFavoriteSeen(game.id).catch(() => undefined);
  }, [game?.id, user?.id, favorite]);
  useEffect(() => {
    if (!game || !user) {
      setImportantRuleIds([]);
      setImportanceReady(false);
      return;
    }
    let active = true;
    setImportanceReady(false);
    const apply = (data: { ruleIds: string[] }) => {
      if (!active) return;
      setImportantRuleIds(data.ruleIds);
      setImportanceReady(true);
    };
    void api.ruleImportance(game.id, user.id, apply).then(apply).catch(() => {
      if (active) setImportanceReady(false);
    });
    return () => { active = false; };
  }, [game?.id, user?.id]);

  const rulesByCategory = useMemo(() => {
    return filterRulesByCategory(game?.rules ?? [], activeCategory, classificationTags);
  }, [game?.rules, activeCategory, classificationTags]);

  const normalizedQuery = ruleQuery.trim().toLocaleLowerCase();
  const rulesByQuery = useMemo(() => {
    if (!normalizedQuery) return rulesByCategory;
    return rulesByCategory.filter((rule) => {
      const haystack = [
        rule.statement,
        rule.commonMistake,
        rule.details,
        ...(rule.playerCounts ? rule.playerCounts.map((c) => `${c}人`) : []),
        ...(rule.editionNotes ?? []),
        ...rule.tags.map((t) => t.name),
      ].join(' ').toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [rulesByCategory, normalizedQuery]);

  const rulesBySpecial = useMemo(() => {
    return rulesByQuery.filter((rule) => {
      if (activePlayerCounts.length > 0) {
        const counts = rule.playerCounts ?? [];
        const hasMatch = activePlayerCounts.some((c) => counts.includes(c));
        if (counts.length > 0 && !hasMatch) return false;
      }
      if (activeEditions.length > 0) {
        const editions = getRuleEditions(rule);
        const hasMatch = activeEditions.some((e) => editions.includes(e));
        if (!hasMatch) return false;
      }
      return true;
    });
  }, [rulesByQuery, activePlayerCounts, activeEditions]);

  const visibleRules = useMemo(() => {
    const filtered = rulesBySpecial.filter((rule) => {
      if (activeTags.length === 0) return true;
      return activeTags.every((tagName) => rule.tags.some((tag) => tag.name === tagName));
    });
    return sortRulesByImportance(filtered);
  }, [rulesBySpecial, activeTags]);

  const allGamePlayerCounts = useMemo(() => {
    const set = new Set<number>();
    game?.rules.forEach((r) => r.playerCounts?.forEach((c) => set.add(c)));
    return Array.from(set).sort((a, b) => a - b);
  }, [game?.rules]);

  const allGameEditions = useMemo(() => {
    const set = new Set<string>();
    game?.rules.forEach((rule) => getRuleEditions(rule).forEach((edition) => set.add(edition)));
    return Array.from(set).sort();
  }, [game?.rules]);

  const availablePlayerCounts = useMemo(() => {
    const validSet = new Set<number>();
    rulesByQuery.forEach((r) => r.playerCounts?.forEach((c) => validSet.add(c)));
    return allGamePlayerCounts.filter((c) => activePlayerCounts.includes(c) || validSet.has(c));
  }, [rulesByQuery, allGamePlayerCounts, activePlayerCounts]);

  const availableEditions = useMemo(() => {
    const validSet = new Set<string>();
    rulesByQuery.forEach((rule) => getRuleEditions(rule).forEach((edition) => validSet.add(edition)));
    return allGameEditions.filter((e) => activeEditions.includes(e) || validSet.has(e));
  }, [rulesByQuery, allGameEditions, activeEditions]);

  const candidateUnselectedTags = useMemo(() => {
    const set = new Set<string>();
    visibleRules.forEach((rule) => {
      rule.tags.forEach((t) => {
        if (!activeTags.includes(t.name)) {
          set.add(t.name);
        }
      });
    });
    let list = Array.from(set).sort();
    if (normalizedQuery) {
      list = list.filter((tag) => tag.toLocaleLowerCase().includes(normalizedQuery));
    }
    return list.slice(0, 6);
  }, [visibleRules, activeTags, normalizedQuery]);

  const hasSpecialOptions = availablePlayerCounts.length > 0 || availableEditions.length > 0;
  const hasActiveFilters = activeTags.length > 0 || activePlayerCounts.length > 0 || activeEditions.length > 0;
  useEffect(() => {
    if (expandedRuleId && !visibleRules.some((rule) => rule.id === expandedRuleId)) {
      setExpandedRuleId(null);
    }
  }, [expandedRuleId, visibleRules]);
  const toggleExpandedRule = (ruleId: string) => {
    setExpandedRuleId((current) => current === ruleId ? null : ruleId);
  };
  const justAdded = (location.state as { justAdded?: number } | null)?.justAdded;
  useEffect(() => {
    if (justAdded) showToast(`已經記下 ${justAdded} 條規則。下次開桌前，它們會在這裡等你。`);
  }, []); // 只在 mount 時執行一次
  const toggleFavorite = async () => {
    if (!game || !user || favoriteSaving) return;
    setFavoriteSaving(true);
    try {
      if (favorite) {
        await api.removeFavorite(game.id);
        setFavorite(false);
        showToast('已從我的收藏移除。');
      } else {
        const result = await api.addFavorite(game.id);
        setFavorite(true);
        if (result.wasFirst) writeHomeMode('personal');
        showToast(result.wasFirst ? '已加入收藏，下次回首頁會顯示在我的收藏。' : '已加入我的收藏。');
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'favorite_limit_reached') {
        try {
          const home = await api.personalHome();
          setFavoriteLimitGames(home.favorites);
        } catch { showToast('收藏暫時無法載入，請稍後再試。'); }
      } else showToast('收藏狀態暫時無法更新，請稍後再試。');
    } finally { setFavoriteSaving(false); }
  };
  const removeFavoriteForSpace = async (favoriteGame: PersonalHomeGame) => {
    if (removingFavoriteId) return;
    setRemovingFavoriteId(favoriteGame.id);
    try {
      await api.removeFavorite(favoriteGame.id);
      setFavoriteLimitGames(undefined);
      showToast(`已移除「${favoriteGame.displayName}」，現在可以收藏這款遊戲。`);
    } catch { showToast('暫時無法移除收藏，請稍後再試。'); }
    finally { setRemovingFavoriteId(undefined); }
  };
  const toggleRuleImportance = async (rule: RuleCardType) => {
    if (!game || !user || !importanceReady || importanceSaving.has(rule.id)) return;
    const wasImportant = importantRuleIds.includes(rule.id);
    const important = !wasImportant;
    const previousCount = rule.importanceCount ?? 0;
    const optimisticCount = Math.max(0, previousCount + (important ? 1 : -1));
    const nextRuleIds = applyRuleImportance(importantRuleIds, rule.id, important);
    setImportantRuleIds(nextRuleIds);
    setGame((current) => current ? { ...current, rules: updateRuleImportanceCount(current.rules, rule.id, optimisticCount) } : current);
    setImportanceSaving((current) => new Set(current).add(rule.id));
    try {
      const result = await api.setRuleImportance(rule.id, important);
      const confirmedRuleIds = applyRuleImportance(nextRuleIds, rule.id, result.important);
      setImportantRuleIds(confirmedRuleIds);
      setGame((current) => current ? { ...current, rules: updateRuleImportanceCount(current.rules, rule.id, result.count) } : current);
      await Promise.all([
        localDb.updateCachedRuleImportance(user.id, game.id, confirmedRuleIds),
        localDb.updateRuleImportanceCount(rule.id, result.count),
      ]);
    } catch {
      setImportantRuleIds((current) => applyRuleImportance(current, rule.id, wasImportant));
      setGame((current) => current ? { ...current, rules: updateRuleImportanceCount(current.rules, rule.id, previousCount) } : current);
      showToast('投票狀態暫時無法更新，請稍後再試。');
    } finally {
      setImportanceSaving((current) => { const next = new Set(current); next.delete(rule.id); return next; });
    }
  };
  if (!game && loading) return <section className="game-page"><header className="game-hero"><div><div className="skeleton-line title" style={{ width: '50%' }} /><div className="skeleton-line medium" /></div></header><div className="game-rules">{Array.from({ length: 4 }, (_, index) => (<div className="skeleton-card" key={index}><div className="skeleton-line title" /><div className="skeleton-line" /><div className="skeleton-line medium" /><div className="skeleton-line short" /></div>))}</div></section>;
  if (!game) return <section className="narrow-page"><h1>找不到這款遊戲</h1><Link to="/">回首頁搜尋</Link></section>;
  const addRuleHref = `/add?game=${encodeURIComponent(game.slug)}`;
  const titleWidthUnits = estimateTitleWidthUnits(game.displayName);
  return <section className="game-page">
    <header className="game-hero">
      <div className="game-hero-info"><h1 style={{ '--game-title-units': titleWidthUnits } as CSSProperties}>{game.displayName}</h1>
        <div className="game-hero-meta">
          {game.englishName && <p className="english-name">{game.englishName}</p>}
        </div>
      </div>
      <div className="inline-actions game-hero-actions">
        {user && <button type="button" className={favorite ? 'button favorite-button active game-header-action' : 'button secondary favorite-button game-header-action'} disabled={favoriteSaving} aria-pressed={Boolean(favorite)} aria-label={favoriteSaving ? '正在處理收藏' : favorite ? '取消收藏' : '收藏遊戲'} onClick={() => void toggleFavorite()}>
          <span className="game-header-action-desktop">{favoriteSaving ? '處理中…' : favorite ? '★ 已收藏' : '☆ 收藏'}</span><span className="game-header-action-mobile" aria-hidden="true">{favoriteSaving ? '處理中' : favorite ? '已收藏' : '收藏'}</span>
        </button>}
        <button type="button" className="button secondary game-header-action" aria-label={`外部資源${(game.externalResources?.length ?? 0) > 0 ? `，共 ${game.externalResources?.length} 項` : ''}`} onClick={() => setExternalResourcesOpen(true)}><span className="game-header-action-desktop">外部資源{(game.externalResources?.length ?? 0) > 0 ? ` · ${game.externalResources?.length}` : ''}</span><span className="game-header-action-mobile" aria-hidden="true">資源</span></button>
        {(user || canEdit) && <>
          {!canEdit && game.reviewStatus === 'pending' && game.renameOwnerId === user?.id && <button type="button" className="button secondary game-header-action" aria-label="編輯遊戲名稱" onClick={() => setEditingGame(true)}><span className="game-header-action-desktop">編輯遊戲名稱</span><span className="game-header-action-mobile" aria-hidden="true">編輯</span></button>}
          {canEdit && <Fragment>{(isAdmin || game.reviewStatus !== 'not_required' || (!game.renameLocked && game.renameOwnerId === user?.id))
            ? <button type="button" className="button secondary game-header-action" aria-label="編輯遊戲名稱" onClick={() => setEditingGame(true)}><span className="game-header-action-desktop">編輯遊戲名稱</span><span className="game-header-action-mobile" aria-hidden="true">編輯</span></button>
            : <span className="muted game-name-locked" title="已有其他作者參與，只有管理員可以修改遊戲名稱。" aria-label="遊戲名稱已鎖定"><span className="game-header-action-desktop">遊戲名稱已鎖定</span><span className="game-header-action-mobile" aria-hidden="true">鎖定</span></span>}
            {game.reviewStatus === 'pending' && <button type="button" className="button secondary game-header-action" aria-label="審核遊戲" onClick={() => void api.reviewGame(game.id).then(async () => { await localDb.invalidateGame(game.id); await load(); }).catch((caught) => showToast(caught instanceof ApiError && caught.code === 'reviewer_nickname_required' ? '請先在帳號頁設定並公開顯示暱稱，才能完成審核。' : '審核失敗，請稍後再試。'))}><span className="game-header-action-desktop">審核遊戲</span><span className="game-header-action-mobile" aria-hidden="true">審核</span></button>}</Fragment>}
          {user && <Link className="button primary game-add-rule-button" to={addRuleHref}>＋記錄</Link>}
        </>}
      </div>
    </header>
    <section className="rule-filters" aria-label="篩選規則">
      {/* 第一列：規則分類 (Category Tabs) */}
      <div className="rule-category-filter" role="tablist" aria-label="規則分類">
        <button type="button" role="tab" aria-selected={activeCategory === 'all'} className={activeCategory === 'all' ? 'active' : ''} onClick={() => setActiveCategory('all')}>
          全部 <small>{game.rules.length}</small>
        </button>
        {RULE_CATEGORIES.map((category) => <button
          type="button"
          role="tab"
          aria-selected={activeCategory === category}
          className={activeCategory === category ? 'active' : ''}
          key={category}
          onClick={() => setActiveCategory(category)}
        >
          {RULE_CATEGORY_LABELS[category]} <small>{game.rules.filter((rule) => effectiveRuleCategories(rule, classificationTags).includes(category)).length}</small>
        </button>)}
      </div>

      {/* 第二列：人數 / 版本 特殊 Tag (若有) */}
      {hasSpecialOptions && (
        <div className="special-tag-filter" aria-label="依人數或版本篩選">
          {availablePlayerCounts.map((count) => {
            const isSelected = activePlayerCounts.includes(count);
            return (
              <button
                type="button"
                key={`player-${count}`}
                aria-pressed={isSelected}
                className={isSelected ? 'tag-chip active special-chip' : 'tag-chip special-chip'}
                onClick={() => togglePlayerCount(count)}
              >
                {isSelected ? '✓ ' : ''}👥 {count}人
              </button>
            );
          })}
          {availableEditions.map((edition) => {
            const isSelected = activeEditions.includes(edition);
            return (
              <button
                type="button"
                key={`edition-${edition}`}
                aria-pressed={isSelected}
                className={isSelected ? 'tag-chip active special-chip' : 'tag-chip special-chip'}
                onClick={() => toggleEdition(edition)}
              >
                {isSelected ? '✓ ' : ''}📦 {edition}
              </button>
            );
          })}
        </div>
      )}

      {/* 第三列：搜尋框 */}
      <div className="rule-search">
        <input
          type="search"
          value={ruleQuery}
          onChange={(event) => setRuleQuery(event.target.value)}
          placeholder="輸入關鍵字搜尋"
          aria-label="關鍵字搜尋"
        />
      </div>

      {/* 第四列：已選取的 Tag (獨立成一行) */}
      {hasActiveFilters && (
        <div className="selected-tags-row" aria-label="已選標籤">
          <span className="selected-tags-label">已選：</span>
          {activePlayerCounts.map((count) => (
            <button type="button" key={`sel-player-${count}`} className="tag-chip active" onClick={() => togglePlayerCount(count)}>
              👥 {count}人 ✕
            </button>
          ))}
          {activeEditions.map((edition) => (
            <button type="button" key={`sel-edition-${edition}`} className="tag-chip active" onClick={() => toggleEdition(edition)}>
              📦 {edition} ✕
            </button>
          ))}
          {activeTags.map((tag) => (
            <button type="button" key={`sel-tag-${tag}`} className="tag-chip active" onClick={() => toggleTag(tag)}>
              #{tag} ✕
            </button>
          ))}
          <button type="button" className="clear-tags-btn" onClick={clearAllFilters}>
            清除篩選 ✕
          </button>
        </div>
      )}

      {/* 第五列：剩餘標籤 Tag (上限 6 個，隨搜尋文字與目前相容規則過濾) */}
      {candidateUnselectedTags.length > 0 && (
        <div className="tag-filter" aria-label="候選標籤">
          {candidateUnselectedTags.map((tag) => (
            <button type="button" className="tag-chip" key={tag} onClick={() => toggleTag(tag)}>
              #{tag}
            </button>
          ))}
        </div>
      )}
    </section>
    <div className="game-rules compact-rules">
      {visibleRules.map((rule) => {
        const toggleExpanded = () => toggleExpandedRule(rule.id);
        if (expandedRuleId !== rule.id) {
          return <CompactRuleCard
            key={rule.id}
            rule={rule}
            onToggleExpanded={toggleExpanded}
            onTagClick={toggleTag}
            onPlayerCountsClick={togglePlayerCounts}
            onEditionClick={toggleEdition}
          />;
        }
        return <RuleCard
          key={rule.id}
          rule={rule}
          showGameContext={false}
          onToggleExpanded={toggleExpanded}
          onTagClick={toggleTag}
          onPlayerCountsClick={togglePlayerCounts}
          onEditionClick={toggleEdition}
          onEdit={canEditRule(rule) ? () => void beginRuleEdit(rule) : undefined}
          importanceVoted={importantRuleIds.includes(rule.id)}
          importanceSaving={importanceSaving.has(rule.id)}
          onToggleImportance={user && importanceReady ? () => void toggleRuleImportance(rule) : undefined}
        />;
      })}
      {visibleRules.length === 0 && <div className="empty-state"><p>找不到符合目前條件的規則。</p></div>}
    </div>
    {game.aliases.length > 0 && <aside className="alias-box"><strong>也可以用這些名稱找到</strong><p>{game.aliases.join('・')}</p></aside>}
    {editing && <RuleEditor game={game} rule={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await localDb.invalidateGame(game.slug); clearSearchCache(); await load(); }} />}
    {editingGame && <GameEditor game={game} onClose={() => setEditingGame(false)} onSaved={async () => { setEditingGame(false); await localDb.invalidateGame(game.slug); clearSearchCache(); await load(); }} />}
    {externalResourcesOpen && <ExternalResourcesDialog game={game} canEdit={canEdit} onClose={() => setExternalResourcesOpen(false)} onChanged={async () => { await localDb.invalidateGame(game.slug); await load(); }} />}
    {favoriteLimitGames && <FavoriteLimitDialog games={favoriteLimitGames} busyId={removingFavoriteId}
      onRemove={(favoriteGame) => void removeFavoriteForSpace(favoriteGame)} onClose={() => setFavoriteLimitGames(undefined)} />}
  </section>;
};

export { RuleEditor } from './GamePageDialogs';
