import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { RuleCard } from '../components/RuleCard';
import { EditionInput } from '../components/EditionInput';
import { PlayerCountInput } from '../components/PlayerCountInput';
import { RuleCategoryInput } from '../components/RuleCategoryInput';
import { TagInput } from '../components/TagInput';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import { RULE_CATEGORIES, RULE_CATEGORY_LABELS, type GameDetail, type RuleCard as RuleCardType, type RuleCategory, type RuleRevision, type TagSelection, type TagSummary } from '../shared/types';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { clearSearchCache } from '../components/GameSearch';
import { hydrateGameTags } from '../lib/tagHydration';
import { canUserEditRule } from '../lib/rulePermissions';
import { collectEditionOptions } from '../lib/editionOptions';
import { FavoriteLimitDialog } from '../components/FavoriteLimitDialog';
import { ApiError } from '../lib/api';
import { writeHomeMode } from '../lib/homeMode';
import type { PersonalHomeGame } from '../shared/types';
import { effectiveRuleCategories, filterRulesByCategory } from '../lib/ruleCategories';
import { applyRuleImportance, sortRulesByImportance, updateRuleImportanceCount } from '../lib/ruleImportance';

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
  const [favorite, setFavorite] = useState<boolean>();
  const [favoriteSaving, setFavoriteSaving] = useState(false);
  const [favoriteLimitGames, setFavoriteLimitGames] = useState<PersonalHomeGame[]>();
  const [removingFavoriteId, setRemovingFavoriteId] = useState<string>();
  const [importantRuleIds, setImportantRuleIds] = useState<string[]>([]);
  const [importanceReady, setImportanceReady] = useState(false);
  const [importanceSaving, setImportanceSaving] = useState<Set<string>>(new Set());
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
    let active = true;
    const applyTags = (data: { tags: TagSummary[] }) => { if (active) setClassificationTags(data.tags); };
    void api.tags(undefined, applyTags).then(applyTags).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!game || !location.hash) return;
    window.setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [game, location.hash]);
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
  const availableTags = useMemo(() => Array.from(new Set(game?.rules.flatMap((rule) => rule.tags.map((tag) => tag.name)) ?? [])).sort(), [game]);
  const normalizedQuery = ruleQuery.trim().toLocaleLowerCase();
  const visibleRules = sortRulesByImportance(filterRulesByCategory(game?.rules ?? [], activeCategory, classificationTags).filter((rule) =>
    (activeTags.length === 0 || activeTags.every((tagName) => rule.tags.some((tag) => tag.name === tagName))) &&
    (!normalizedQuery || [rule.statement, rule.commonMistake, rule.details, ...rule.tags.map((tag) => tag.name)].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)))
  ));
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
  return <section className="game-page">
    <header className="game-hero">
      <div><h1>{game.displayName}</h1>{game.englishName && <p className="english-name">{game.englishName}</p>}
        <p>{game.ruleCount} 條易錯規則紀錄</p></div>
      {(user || canEdit) && <div className="inline-actions">
        {user && <button type="button" className={favorite ? 'button favorite-button active' : 'button secondary favorite-button'} disabled={favoriteSaving} aria-pressed={Boolean(favorite)} onClick={() => void toggleFavorite()}>
          {favoriteSaving ? '處理中…' : favorite ? '★ 已收藏' : '☆ 收藏'}
        </button>}
        {canEdit && <Fragment>{(isAdmin || (!game.renameLocked && game.renameOwnerId === user?.id))
          ? <button type="button" className="button secondary" onClick={() => setEditingGame(true)}>編輯遊戲名稱</button>
          : <span className="muted game-name-locked" title="已有其他作者參與，只有管理員可以修改遊戲名稱。">遊戲名稱已鎖定</span>}
          <Link className="button primary" to={`/add?game=${game.slug}`}>＋新增規則</Link></Fragment>}
      </div>}
    </header>
    <section className="rule-filters" aria-label="篩選規則">
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
      <label className="rule-search">在這款遊戲中搜尋<input type="search" value={ruleQuery} onChange={(event) => setRuleQuery(event.target.value)} placeholder="例如：補牌、平手、三人局" /></label>
          {availableTags.length > 0 && (
            <div className="tag-filter" aria-label="依標籤篩選">
              {availableTags.map((tag) => {
                const isSelected = activeTags.includes(tag);
                return (
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    className={isSelected ? 'tag-chip active' : 'tag-chip'}
                    key={tag}
                    onClick={() => toggleTag(tag)}
                  >
                    {isSelected ? '✓ ' : ''}#{tag}
                  </button>
                );
              })}
              {activeTags.length > 0 && (
                <button
                  type="button"
                  className="clear-tags-btn"
                  onClick={() => setActiveTags([])}
                >
                  清除篩選 ✕
                </button>
              )}
            </div>
          )}
    </section>
    <div className="game-rules">
      {visibleRules.map((rule) => <RuleCard key={rule.id} rule={rule} onTagClick={toggleTag} onEdit={canEditRule(rule) ? () => setEditing(rule) : undefined}
        importanceVoted={importantRuleIds.includes(rule.id)} importanceSaving={importanceSaving.has(rule.id)}
        onToggleImportance={user && importanceReady ? () => void toggleRuleImportance(rule) : undefined} />)}
      {visibleRules.length === 0 && <div className="empty-state"><p>找不到符合目前條件的規則。</p><button type="button" className="text-action" onClick={() => { setActiveCategory('all'); setActiveTags([]); setRuleQuery(''); }}>清除篩選</button></div>}
    </div>
    {game.aliases.length > 0 && <aside className="alias-box"><strong>也可以用這些名稱找到</strong><p>{game.aliases.join('・')}</p></aside>}
    {editing && <RuleEditor game={game} rule={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await localDb.invalidateRuleEntity(editing.id); await localDb.invalidateGame(game.slug); clearSearchCache(); await load(); }} />}
    {editingGame && <GameEditor game={game} onClose={() => setEditingGame(false)} onSaved={async () => { setEditingGame(false); await localDb.invalidateGame(game.slug); await localDb.invalidateHome(); clearSearchCache(); await load(); }} />}
    {favoriteLimitGames && <FavoriteLimitDialog games={favoriteLimitGames} busyId={removingFavoriteId}
      onRemove={(favoriteGame) => void removeFavoriteForSpace(favoriteGame)} onClose={() => setFavoriteLimitGames(undefined)} />}
  </section>;
};

export const RuleEditor = ({ game, rule, onClose, onSaved }: { game: GameDetail; rule: RuleCardType; onClose(): void; onSaved(): Promise<void> }) => {
  const { isAdmin } = useSession();
  const { confirm } = useConfirm();
  const [statement, setStatement] = useState(rule.statement);
  const [commonMistake, setCommonMistake] = useState(rule.commonMistake ?? '');
  const [details, setDetails] = useState(rule.details ?? '');
  const [categories, setCategories] = useState(rule.categories ?? []);
  const [playerCounts, setPlayerCounts] = useState(rule.playerCounts ?? []);
  const [editionNotes, setEditionNotes] = useState(rule.editionNotes ?? (rule.editionNote ? [rule.editionNote] : []));
  const [tagSelections, setTagSelections] = useState<TagSelection[]>(rule.tags.map((tag) => ({ id: tag.id, name: tag.name, unresolved: tag.unresolved })));
  const [sourceLabel, setSourceLabel] = useState(rule.sourceLabel ?? '');
  const [sourceUrl, setSourceUrl] = useState(rule.sourceUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [revisions, setRevisions] = useState<RuleRevision[]>();
  const editionOptions = useMemo(() => collectEditionOptions(game.rules), [game.rules]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = ''; };
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    try {
      await api.patchRule(rule.id, {
        statement, commonMistake: commonMistake || null, details: details || null, categories, playerCounts, editionNotes,
        tagIds: tagSelections.flatMap((tag) => tag.id ? [tag.id] : []),
        newTagNames: tagSelections.flatMap((tag) => tag.id ? [] : [tag.name]),
        sourceLabel: sourceLabel || null, sourceUrl: sourceUrl || null,
      });
      await onSaved();
    } finally { setSaving(false); }
  };
  const hide = async () => {
    if (await confirm({ title: '隱藏規則？', message: '隱藏後仍可從管理頁恢復。', confirmLabel: '隱藏規則', tone: 'danger' })) {
      await api.hideRule(rule.id); await onSaved();
    }
  };
  return <div className="modal-backdrop" role="presentation">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-rule-title">
      <div className="modal-heading"><h2 id="edit-rule-title">編輯規則</h2><button type="button" aria-label="關閉編輯視窗" onClick={onClose}>×</button></div>
      <label>規則結論<textarea rows={3} value={statement} onChange={(event) => setStatement(event.target.value)} /></label>
      <label>玩錯情況<textarea rows={2} value={commonMistake} onChange={(event) => setCommonMistake(event.target.value)} /></label>
      <label>補充說明<textarea rows={3} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
      <TagInput value={tagSelections} onChange={setTagSelections} canCreate={isAdmin} availableTags={game.rules.flatMap((gameRule) => gameRule.tags).filter((tag) => !tag.unresolved)} detectionInput={{ statement, commonMistake, details }} />
      <RuleCategoryInput value={categories} onChange={setCategories} />
      <PlayerCountInput value={playerCounts} onChange={setPlayerCounts} />
      <EditionInput value={editionNotes} options={editionOptions} onChange={setEditionNotes} />
      <div className="two-columns"><label>參考資料<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} /></label><label>資料網址<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label></div>
      <section className="revision-panel">
        <button type="button" className="text-action" onClick={() => void api.ruleRevisions(rule.id).then((data) => setRevisions(data.revisions))}>查看版本紀錄</button>
        {revisions && (revisions.length ? <div className="admin-list">{revisions.map((revision) => <div key={revision.id}>
          <span><strong>{revision.previousStatement}</strong><small>{new Date(revision.createdAt).toLocaleString('zh-TW')}・{revision.reason}</small></span>
          <button type="button" className="text-action" onClick={() => void confirm({ title: '恢復這個版本？', message: '目前內容也會保留在版本紀錄中。', confirmLabel: '恢復版本' }).then((confirmed) => { if (confirmed) return api.restoreRevision(rule.id, revision.id).then(onSaved); })}>恢復</button>
        </div>)}</div> : <p className="muted">尚無較早版本。</p>)}
      </section>
      <div className="modal-actions"><button type="button" className="danger-link" onClick={() => void hide()}>隱藏</button><div><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="button" className="button primary" disabled={!statement.trim() || saving} onClick={() => void save()}>{saving ? '儲存中…' : '儲存修改'}</button></div></div>
    </div>
  </div>;
};

const GameEditor = ({ game, onClose, onSaved }: { game: GameDetail; onClose(): void; onSaved(): Promise<void> }) => {
  const [displayName, setDisplayName] = useState(game.displayName);
  const [englishName, setEnglishName] = useState(game.englishName ?? '');
  const [aliases, setAliases] = useState(game.aliases.filter((alias) => alias !== game.displayName && alias !== game.englishName).join('\n'));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.style.overflow = ''; };
  }, [onClose]);
  const save = async () => {
    setSaving(true);
    try {
      await api.patchGame(game.id, { displayName, englishName: englishName || undefined, aliases: aliases.split('\n').map((value) => value.trim()).filter(Boolean) });
      await onSaved();
    } finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-game-title">
      <div className="modal-heading"><h2 id="edit-game-title">編輯遊戲名稱</h2><button type="button" aria-label="關閉編輯視窗" onClick={onClose}>×</button></div>
      <label>顯示名稱<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>英文名稱<input value={englishName} onChange={(event) => setEnglishName(event.target.value)} /></label>
      <label>可搜尋的別名（每行一個）<textarea rows={5} value={aliases} onChange={(event) => setAliases(event.target.value)} /></label>
      <div className="modal-actions"><span /><div><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="button" className="button primary" disabled={!displayName.trim() || saving} onClick={() => void save()}>{saving ? '儲存中…' : '儲存遊戲'}</button></div></div>
    </div>
  </div>;
};
