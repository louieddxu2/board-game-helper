import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { clearSearchCache } from '../components/GameSearch';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import { hydrateGameTags } from '../lib/tagHydration';
import { canUserEditRule } from '../lib/rulePermissions';
import type { GameDetail, GameSummary, RuleCard } from '../shared/types';
import { RuleEditor } from './GamePage';

const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString('zh-TW', {
  year: 'numeric', month: 'numeric', day: 'numeric',
});

const statusLabel: Record<RuleCard['status'], string> = {
  published: '已發布',
  hidden: '已隱藏',
  draft: '草稿',
};

const sourceCell = (rule: RuleCard) => {
  const label = rule.sourceLabel || '未填寫';
  return rule.sourceUrl ? <a href={rule.sourceUrl} target="_blank" rel="noreferrer">{label} ↗</a> : label;
};

const ruleTagNames = (rule: RuleCard) => rule.tags.length
  ? <span className="catalog-rule-tag-list">{rule.tags.map((tag) => <span key={tag.id}>#{tag.name}</span>)}</span>
  : '—';

const ScrollableGameName = ({ name, emphasized = false }: { name: string; emphasized?: boolean }) => {
  const scrollerRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => setOverflowing(scroller.scrollWidth > scroller.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [name]);
  return <span className="catalog-name-viewport" title={name}>
    <span ref={scrollerRef} className="catalog-name-scroller" tabIndex={overflowing ? 0 : undefined}>{emphasized ? <strong>{name}</strong> : name}</span>
    {overflowing && <span className="catalog-name-ellipsis" aria-hidden="true">…</span>}
  </span>;
};

const RulesSheet = ({ game, activeTags, onTagsChange, onEdit, canEditRule }: {
  game: GameDetail;
  activeTags: string[];
  onTagsChange(tags: string[]): void;
  onEdit(rule: RuleCard): void;
  canEditRule(rule: RuleCard): boolean;
}) => {
  const availableTags = Array.from(new Set(game.rules.flatMap((rule) => rule.tags.map((tag) => tag.name))))
    .sort((left, right) => left.localeCompare(right, 'zh-Hant'));
  const visibleRules = activeTags.length
    ? game.rules.filter((rule) => activeTags.every((name) => rule.tags.some((tag) => tag.name === name)))
    : game.rules;
  const toggleTag = (name: string) => onTagsChange(activeTags.includes(name)
    ? activeTags.filter((tag) => tag !== name)
    : [...activeTags, name]);

  return <div className="catalog-detail-wrap">
    <div className="catalog-detail-heading">
      <div className="catalog-tag-filters" role="group" aria-label="依標籤篩選規則">
        {availableTags.length > 0 && <button type="button" className={activeTags.length === 0 ? 'active' : ''} onClick={() => onTagsChange([])}>全部</button>}
        {availableTags.map((tag) => <button type="button" key={tag} className={activeTags.includes(tag) ? 'active' : ''} onClick={() => toggleTag(tag)}>#{tag}</button>)}
      </div>
      <Link to={`/games/${game.slug}`}>開啟一般遊戲頁 ↗</Link>
    </div>
    <div className="catalog-detail-scroll">
      <table className="catalog-rules-table">
        <colgroup><col className="catalog-col-status" /><col className="catalog-col-rule" /><col className="catalog-col-mistake" /><col className="catalog-col-details" /><col className="catalog-col-source" /><col className="catalog-col-tags" /><col className="catalog-col-updated" /></colgroup>
        <thead>
          <tr><th>狀態</th><th>規則</th><th>玩錯情況</th><th>補充</th><th>來源</th><th>Tag</th><th>更新／操作</th></tr>
        </thead>
        <tbody>
          {visibleRules.length === 0 && <tr><td colSpan={7} className="catalog-empty-cell">沒有符合篩選條件的規則。</td></tr>}
          {visibleRules.map((rule) => <tr key={rule.id}>
            <td data-label="狀態" className="catalog-rule-status-cell"><span className={`catalog-status catalog-status-${rule.status}`}>{statusLabel[rule.status]}</span></td>
            <td data-label="規則" className="catalog-text-cell catalog-rule-statement"><strong>{rule.statement}</strong></td>
            <td data-label="玩錯情況" className="catalog-text-cell">{rule.commonMistake || '—'}</td>
            <td data-label="補充" className="catalog-text-cell">{rule.details || '—'}</td>
            <td data-label="來源" className="catalog-rule-side catalog-rule-source">{sourceCell(rule)}</td>
            <td data-label="Tag" className="catalog-rule-side catalog-rule-tags">{ruleTagNames(rule)}</td>
            <td data-label="更新於" className="catalog-rule-side catalog-update-cell"><span>{formatDate(rule.updatedAt || game.updatedAt)}</span>{canEditRule(rule) && <button type="button" className="text-action" onClick={() => onEdit(rule)}>編輯</button>}</td>
          </tr>)}
        </tbody>
      </table>
      <div className="catalog-mobile-rules">
        {visibleRules.length === 0 && <p className="catalog-mobile-empty">沒有符合目前標籤篩選的規則。</p>}
        {visibleRules.map((rule) => <article className="catalog-mobile-rule-card" key={rule.id}>
          <div className="catalog-mobile-rule-main">
            <strong className="catalog-mobile-rule-statement">{rule.statement}</strong>
            {rule.commonMistake && <div className="catalog-mobile-rule-section"><span>玩錯情況</span><p>{rule.commonMistake}</p></div>}
            {rule.details && <div className="catalog-mobile-rule-section"><span>補充</span><p>{rule.details}</p></div>}
          </div>
          <aside className="catalog-mobile-rule-meta">
            <div className="catalog-mobile-rule-actions">
              <span className={`catalog-status catalog-status-${rule.status}`}>{statusLabel[rule.status]}</span>
              {canEditRule(rule) && <button type="button" className="text-action" onClick={() => onEdit(rule)}>編輯</button>}
            </div>
            <div><span>來源</span><p>{sourceCell(rule)}</p></div>
            <div><span>Tag</span><p>{ruleTagNames(rule)}</p></div>
            <div><span>更新於</span><time dateTime={new Date(rule.updatedAt || game.updatedAt).toISOString()}>{formatDate(rule.updatedAt || game.updatedAt)}</time></div>
          </aside>
        </article>)}
      </div>
    </div>
  </div>;
};

export const CatalogPage = () => {
  const { canEdit, loading, user, isAdmin } = useSession();
  const canEditRule = (rule: RuleCard) => canUserEditRule(rule, user, isAdmin);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameQuery, setGameQuery] = useState('');
  const [expandedGameId, setExpandedGameId] = useState<string>();
  const [expandedGame, setExpandedGame] = useState<GameDetail>();
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [editingRule, setEditingRule] = useState<RuleCard>();
  const [loadingGameId, setLoadingGameId] = useState<string>();
  const [error, setError] = useState('');
  const detailRequestId = useRef(0);

  const filteredGames = useMemo(() => {
    const query = gameQuery.trim().toLocaleLowerCase();
    if (!query) return games;
    return games.filter((game) => [game.displayName, game.englishName, ...(game.aliases ?? [])]
      .some((name) => name?.toLocaleLowerCase().includes(query)));
  }, [gameQuery, games]);

  const updateGameSummary = (detail: GameDetail) => {
    const { rules: _rules, ...gameSummary } = detail;
    setGames((current) => current.map((summary) => summary.id === detail.id
      ? { ...summary, ...gameSummary, ruleCount: detail.totalRuleCount ?? detail.ruleCount }
      : summary));
  };

  const loadGames = async () => {
    setError('');
    try {
      const data = await api.editorCatalogGames();
      setGames(data.games);
    } catch {
      setError('列表載入失敗，請重新整理後再試。');
    }
  };

  const reloadGames = async () => {
    setError('');
    try {
      const data = await api.reloadEditorCatalogGames();
      setGames(data.games);
      detailRequestId.current += 1;
      setExpandedGameId(undefined);
      setExpandedGame(undefined);
      setActiveTags([]);
      setEditingRule(undefined);
      setLoadingGameId(undefined);
    } catch {
      setError('列表載入失敗，請重新整理後再試。');
    }
  };

  useEffect(() => { if (canEdit) void loadGames(); }, [canEdit]);

  const toggleGame = async (game: GameSummary) => {
    const requestId = ++detailRequestId.current;
    if (expandedGameId === game.id) {
      setExpandedGameId(undefined);
      setExpandedGame(undefined);
      setActiveTags([]);
      return;
    }
    setExpandedGameId(game.id);
    setExpandedGame(undefined);
    setActiveTags([]);
    setLoadingGameId(game.id);
    setError('');
    try {
      const data = await api.game(game.id, true);
      const hydratedGame = await hydrateGameTags(data.game);
      if (requestId !== detailRequestId.current) return;
      setExpandedGame(hydratedGame);
      updateGameSummary(hydratedGame);
    } catch {
      if (requestId !== detailRequestId.current) return;
      setExpandedGameId(undefined);
      setError('這個遊戲的規則載入失敗，請再試一次。');
    } finally {
      if (requestId === detailRequestId.current) setLoadingGameId(undefined);
    }
  };

  const refreshEditedRule = async () => {
    if (!expandedGame || !editingRule) return;
    const game = expandedGame;
    const ruleId = editingRule.id;
    setEditingRule(undefined);
    await localDb.invalidateRuleEntity(ruleId);
    await localDb.invalidateGame(game.id);
    clearSearchCache();
    try {
      const data = await api.game(game.id, true);
      const hydratedGame = await hydrateGameTags(data.game);
      setExpandedGame(hydratedGame);
      updateGameSummary(hydratedGame);
    } catch {
      setError('規則已送出，但列表重新載入失敗，請按重新整理。');
    }
  };

  if (loading) return <section className="catalog-page"><p className="eyebrow">列表</p><h1>正在確認權限…</h1></section>;
  if (!canEdit) return <Navigate to="/" replace />;

  return <section className="catalog-page">
    <header className="catalog-header">
      <div>
        <p className="eyebrow">Editor / Admin</p>
        <h1>遊戲列表</h1>
      </div>
      <button type="button" className="button secondary" onClick={() => void reloadGames()}>重新整理</button>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="catalog-toolbar">
      <label className="catalog-game-filter">篩選遊戲名稱<input type="search" value={gameQuery} onChange={(event) => setGameQuery(event.target.value)} placeholder="輸入中文或英文名稱" /></label>
      <strong>{gameQuery.trim() ? `${filteredGames.length} / ${games.length}` : games.length} 款遊戲</strong>
    </div>
    <div className="catalog-sheet-scroll">
      <table className="catalog-table">
        <colgroup><col className="catalog-col-expand" /><col className="catalog-col-game" /><col className="catalog-col-english" /><col className="catalog-col-count" /><col className="catalog-col-date" /></colgroup>
        <thead><tr><th aria-label="展開"></th><th>遊戲</th><th>英文名稱</th><th>規則數</th><th>最後更新</th></tr></thead>
        <tbody>
          {filteredGames.length === 0 && !error && <tr><td colSpan={5} className="catalog-empty-cell">找不到符合名稱的遊戲。</td></tr>}
          {filteredGames.map((game) => <Fragment key={game.id}>
            <tr
              className={expandedGameId === game.id ? 'catalog-game-row expanded' : 'catalog-game-row'}
              role="button"
              tabIndex={0}
              aria-expanded={expandedGameId === game.id}
              onClick={() => void toggleGame(game)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void toggleGame(game);
                }
              }}
            >
              <td className="catalog-expand-cell"><span className="catalog-expand-icon" aria-hidden="true">{expandedGameId === game.id ? '−' : '+'}</span></td>
              <td className="catalog-game-name"><ScrollableGameName name={game.displayName} emphasized /></td>
              <td data-label="英文名稱" className="catalog-game-english">{game.englishName ? <ScrollableGameName name={game.englishName} /> : '—'}</td>
              <td data-label="規則數" data-mobile-label="規則" className="catalog-game-count">{game.ruleCount}</td>
              <td data-label="最後更新" data-mobile-label="更新" className="catalog-game-updated">{formatDate(game.latestRuleUpdatedAt ?? game.updatedAt)}</td>
            </tr>
            {expandedGameId === game.id && <tr className="catalog-detail-row"><td colSpan={5} className="catalog-detail-cell">{loadingGameId === game.id ? <p className="catalog-loading">正在載入全部規則…</p> : expandedGame?.id === game.id ? <RulesSheet game={expandedGame} activeTags={activeTags} onTagsChange={setActiveTags} onEdit={setEditingRule} canEditRule={canEditRule} /> : null}</td></tr>}
          </Fragment>)}
        </tbody>
      </table>
    </div>
    {expandedGame && editingRule && canEditRule(editingRule) && <RuleEditor game={expandedGame} rule={editingRule} onClose={() => setEditingRule(undefined)} onSaved={refreshEditedRule} />}
  </section>;
};
