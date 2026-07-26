import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { api } from '../lib/api';
import { hydrateGameTags } from '../lib/tagHydration';
import type { GameDetail, GameSummary, RuleCard } from '../shared/types';

const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString('zh-TW', {
  year: 'numeric', month: 'numeric', day: 'numeric',
});

const statusLabel: Record<RuleCard['status'], string> = {
  published: '已發布',
  hidden: '已隱藏',
  draft: '草稿',
};

const stageLabel: Record<string, string> = {
  setup: '設置',
  round: '回合',
  action: '行動',
  end_scoring: '結算',
  edition_player_count: '版本／人數',
  always: '常規',
  uncategorized: '未分類',
};

const sourceCell = (rule: RuleCard) => {
  const label = rule.sourceLabel || '未填寫';
  return rule.sourceUrl ? <a href={rule.sourceUrl} target="_blank" rel="noreferrer">{label} ↗</a> : label;
};

const RulesSheet = ({ game }: { game: GameDetail }) => (
  <div className="catalog-detail-wrap">
    <div className="catalog-detail-heading">
      <strong>{game.displayName} 的全部規則</strong>
      <Link to={`/games/${game.slug}`}>開啟一般遊戲頁 ↗</Link>
    </div>
    <div className="catalog-detail-scroll">
      <table className="catalog-rules-table">
        <thead>
          <tr><th>狀態</th><th>規則</th><th>常見錯法</th><th>補充</th><th>階段</th><th>來源</th><th>Tag</th><th>更新</th></tr>
        </thead>
        <tbody>
          {game.rules.length === 0 && <tr><td colSpan={8} className="catalog-empty-cell">這個遊戲目前沒有規則。</td></tr>}
          {game.rules.map((rule) => <tr key={rule.id}>
            <td><span className={`catalog-status catalog-status-${rule.status}`}>{statusLabel[rule.status]}</span></td>
            <td className="catalog-text-cell"><strong>{rule.statement}</strong></td>
            <td className="catalog-text-cell">{rule.commonMistake || '—'}</td>
            <td className="catalog-text-cell">{rule.details || '—'}</td>
            <td>{stageLabel[rule.flowStage || 'uncategorized'] || rule.flowStage || '未分類'}</td>
            <td>{sourceCell(rule)}</td>
            <td>{rule.tags.length ? rule.tags.map((tag) => `#${tag.name}`).join(' ') : '—'}</td>
            <td>{formatDate(rule.updatedAt || game.updatedAt)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>
);

export const CatalogPage = () => {
  const { canEdit, loading } = useSession();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [expandedGameId, setExpandedGameId] = useState<string>();
  const [expandedGame, setExpandedGame] = useState<GameDetail>();
  const [loadingGameId, setLoadingGameId] = useState<string>();
  const [error, setError] = useState('');
  const detailRequestId = useRef(0);

  const loadGames = async (forceRefresh = false) => {
    setError('');
    try {
      const data = await api.editorCatalogGames(forceRefresh);
      setGames(data.games);
      if (forceRefresh) {
        detailRequestId.current += 1;
        setExpandedGameId(undefined);
        setExpandedGame(undefined);
        setLoadingGameId(undefined);
      }
    } catch {
      setError('資料表載入失敗，請重新整理後再試。');
    }
  };

  useEffect(() => { if (canEdit) void loadGames(); }, [canEdit]);

  const toggleGame = async (game: GameSummary) => {
    const requestId = ++detailRequestId.current;
    if (expandedGameId === game.id) {
      setExpandedGameId(undefined);
      setExpandedGame(undefined);
      return;
    }
    setExpandedGameId(game.id);
    setExpandedGame(undefined);
    setLoadingGameId(game.id);
    setError('');
    try {
      const data = await api.game(game.id, false, true);
      const hydratedGame = await hydrateGameTags(data.game);
      if (requestId !== detailRequestId.current) return;
      setExpandedGame(hydratedGame);
      const { rules: _rules, ...gameSummary } = hydratedGame;
      setGames((current) => current.map((summary) => summary.id === hydratedGame.id
        ? { ...summary, ...gameSummary, ruleCount: hydratedGame.totalRuleCount ?? hydratedGame.ruleCount }
        : summary));
    } catch {
      if (requestId !== detailRequestId.current) return;
      setExpandedGameId(undefined);
      setError('這個遊戲的規則載入失敗，請再試一次。');
    } finally {
      if (requestId === detailRequestId.current) setLoadingGameId(undefined);
    }
  };

  if (loading) return <section className="catalog-page"><p className="eyebrow">資料表</p><h1>正在確認權限…</h1></section>;
  if (!canEdit) return <Navigate to="/" replace />;

  return <section className="catalog-page">
    <header className="catalog-header">
      <div>
        <p className="eyebrow">Editor / Admin</p>
        <h1>遊戲資料表</h1>
      </div>
      <button type="button" className="button secondary" onClick={() => void loadGames(true)}>重新整理</button>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="catalog-toolbar"><strong>{games.length} 款遊戲</strong></div>
    <div className="catalog-sheet-scroll">
      <table className="catalog-table">
        <thead><tr><th aria-label="展開"></th><th>遊戲</th><th>英文名稱</th><th>規則數</th><th>最後更新</th></tr></thead>
        <tbody>
          {games.length === 0 && !error && <tr><td colSpan={5} className="catalog-empty-cell">目前沒有遊戲資料。</td></tr>}
          {games.map((game) => <Fragment key={game.id}>
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
              <td><strong>{game.displayName}</strong></td>
              <td>{game.englishName || '—'}</td>
              <td>{game.ruleCount}</td>
              <td>{formatDate(game.latestRuleUpdatedAt ?? game.updatedAt)}</td>
            </tr>
            {expandedGameId === game.id && <tr><td colSpan={5} className="catalog-detail-cell">{loadingGameId === game.id ? <p className="catalog-loading">正在載入全部規則…</p> : expandedGame?.id === game.id ? <RulesSheet game={expandedGame} /> : null}</td></tr>}
          </Fragment>)}
        </tbody>
      </table>
    </div>
  </section>;
};
