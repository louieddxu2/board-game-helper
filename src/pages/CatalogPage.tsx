import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import type { GameDetail, GameSummary, RuleCard } from '../shared/types';
import { loginHref } from '../lib/loginNavigation';

const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString('zh-TW', {
  year: 'numeric', month: 'numeric', day: 'numeric',
});

// Only rules that are not public carry a mark; published rules need none.
const statusMark = (rule: RuleCard) => rule.reviewStatus === 'pending' ? '未審核'
  : rule.status === 'hidden' ? '已隱藏' : rule.status === 'draft' ? '草稿' : undefined;

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

// The same compact rows as the homepage's recent rules: the rule text only, and a tap opens it on the game page.
const RulesSheet = ({ game }: { game: GameDetail }) => <div className="catalog-detail-wrap">
  {game.rules.length === 0 ? <p className="catalog-rules-empty">這款遊戲還沒有規則。</p> : <ul className="catalog-rule-list">
    {game.rules.map((rule) => {
      const mark = statusMark(rule);
      return <li key={rule.id}><Link to={`/games/${game.slug}#rule-${encodeURIComponent(rule.id)}`}>
        <span className="catalog-rule-text">{rule.statement}</span>
        {mark && <span className={`catalog-status catalog-status-${rule.reviewStatus === 'pending' ? 'draft' : rule.status}`}>{mark}</span>}
      </Link></li>;
    })}
  </ul>}
</div>;

export const CatalogPage = () => {
  const location = useLocation();
  const { canEdit, loading, user } = useSession();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [viewParams, setViewParams] = useSearchParams();
  const navigationType = useNavigationType();
  const [gameQuery, setGameQuery] = useState(() => viewParams.get('q') ?? '');
  useEffect(() => {
    if (navigationType !== 'REPLACE') setGameQuery(viewParams.get('q') ?? '');
  }, [viewParams, navigationType]);
  const expandedGameId = viewParams.get('game') ?? undefined;
  const [expandedGame, setExpandedGame] = useState<GameDetail>();
  const [loadingGameId, setLoadingGameId] = useState<string>();
  const [error, setError] = useState('');
  const [pendingRuleCounts, setPendingRuleCounts] = useState<Record<string, number>>({});
  const [pendingGameIds, setPendingGameIds] = useState<string[]>([]);
  const onlyPending = canEdit && viewParams.get('pending') === '1';
  const detailRequestId = useRef(0);
  const updateView = (patch: { q?: string; game?: string; pending?: boolean }) => setViewParams(current => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      if (value) next.set(key, value === true ? '1' : value);
    }
    return next;
  }, { replace: true });

  const filteredGames = useMemo(() => {
    const query = gameQuery.trim().toLocaleLowerCase();
    return games.filter((game) => {
      if (onlyPending && !(pendingRuleCounts[game.id] || pendingGameIds.includes(game.id))) return false;
      if (!query) return true;
      return [game.displayName, game.englishName, ...(game.aliases ?? [])]
        .some((name) => name?.toLocaleLowerCase().includes(query));
    });
  }, [gameQuery, games, onlyPending, pendingRuleCounts, pendingGameIds]);

  const updateGameSummary = (detail: GameDetail) => {
    const { rules: _rules, ...gameSummary } = detail;
    setGames((current) => current.map((summary) => summary.id === detail.id
      ? { ...summary, ...gameSummary, ruleCount: detail.totalRuleCount ?? detail.ruleCount }
      : summary));
  };

  const loadGames = async () => {
    setError('');
    try {
      const data = await api.catalogGames(canEdit, (updated) => setGames(updated.games));
      setGames(data.games);
    } catch {
      setError('列表載入失敗，請重新整理後再試。');
    }
  };

  const syncGames = async () => {
    setError('');
    try {
      const data = await api.syncCatalogGames(canEdit);
      setGames(data.games);
    } catch {
      setError('列表載入失敗，請重新整理後再試。');
    }
  };

  useEffect(() => { if (user) void loadGames(); }, [user?.id, canEdit]);
  useEffect(() => {
    if (!canEdit) { setPendingRuleCounts({}); setPendingGameIds([]); return; }
    void api.editorContributions().then((data) => {
      setPendingRuleCounts(Object.fromEntries(data.games.map((row) => [row.gameId, row.pendingRuleCount])));
      setPendingGameIds(data.pendingGameIds);
    }).catch(() => undefined);
  }, [canEdit]);

  const toggleGame = (game: GameSummary) => updateView({ game: expandedGameId === game.id ? undefined : game.id });
  const availableExpandedGameId = games.some(game => game.id === expandedGameId) ? expandedGameId : undefined;
  useEffect(() => {
    const requestId = ++detailRequestId.current;
    setExpandedGame(undefined);
    if (!availableExpandedGameId) { setLoadingGameId(undefined); return; }
    setLoadingGameId(availableExpandedGameId);
    setError('');
    void (async () => {
      try {
        // The rows show only rule text, so the game's tags need not be resolved here.
        const show = ({ game: detail }: { game: GameDetail }) => {
          if (requestId !== detailRequestId.current) return;
          setExpandedGame(detail);
          updateGameSummary(detail);
        };
        show(await api.game(availableExpandedGameId, canEdit, show));
      } catch {
        if (requestId !== detailRequestId.current) return;
        setError('這個遊戲的規則載入失敗，請再試一次。');
      } finally {
        if (requestId === detailRequestId.current) setLoadingGameId(undefined);
      }
    })();
    return () => { detailRequestId.current++; };
  }, [availableExpandedGameId, canEdit]);

  if (loading) return <section className="catalog-page"><h1>正在確認權限…</h1></section>;
  if (!user) return <Navigate to={loginHref(location)} replace />;

  return <section className="catalog-page">
    <header className="catalog-header">
      <div className="catalog-heading">
        <h1>遊戲列表</h1>
        <span className="catalog-count" role="status">{gameQuery.trim() || onlyPending ? `${filteredGames.length} / ${games.length}` : games.length} 款</span>
      </div>
      {canEdit && <button type="button" className="button secondary catalog-sync-button" onClick={() => void syncGames()}>同步目錄</button>}
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="catalog-toolbar">
      <label className="catalog-game-filter"><span className="sr-only">篩選遊戲名稱</span><input type="search" value={gameQuery} onChange={(event) => { setGameQuery(event.target.value); updateView({ q: event.target.value }); }} placeholder="篩選遊戲名稱（中／英文）" /></label>
      {canEdit && <label className="checkbox-row"><input type="checkbox" checked={onlyPending} onChange={(event) => updateView({ pending: event.target.checked })} />只看待審核</label>}
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
              <td data-label="規則數" data-mobile-label="規則" className="catalog-game-count">{game.ruleCount}{canEdit && Boolean(pendingRuleCounts[game.id]) && <small>・待審核 {pendingRuleCounts[game.id]}</small>}{canEdit && pendingGameIds.includes(game.id) && <small>・新遊戲待審核</small>}</td>
              <td data-label="最後更新" data-mobile-label="更新" className="catalog-game-updated">{formatDate(game.latestRuleUpdatedAt ?? game.updatedAt)}</td>
            </tr>
            {expandedGameId === game.id && <tr className="catalog-detail-row"><td colSpan={5} className="catalog-detail-cell">{loadingGameId === game.id ? <p className="catalog-loading">正在載入規則…</p> : expandedGame?.id === game.id ? <RulesSheet game={expandedGame} /> : null}</td></tr>}
          </Fragment>)}
        </tbody>
      </table>
    </div>
  </section>;
};
