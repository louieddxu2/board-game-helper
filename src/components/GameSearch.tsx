import { useEffect, useId, useState } from 'react';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { GameSummary, RuleSearchResult } from '../shared/types';
import { useSession } from '../context/SessionContext';
import { useNavigate } from 'react-router-dom';

interface Props {
  value: string;
  onChange(value: string): void;
  onSelect(game: GameSummary): void;
  selectedId?: string;
  allowCreate?: boolean;
  onCreate?(name: string): void;
  includeRules?: boolean;
  onRuleSelect?(rule: RuleSearchResult): void;
}

type SearchResponse = { games: GameSummary[]; rules: RuleSearchResult[] };
type CachedSearch = SearchResponse & { cachedAt: number };
const SEARCH_CACHE_FRESH_MS = 60 * 1000;
const searchCache = new Map<string, CachedSearch>();
const rememberSearch = (key: string, response: SearchResponse) => {
  if (searchCache.size >= 100) searchCache.delete(searchCache.keys().next().value as string);
  searchCache.set(key, { ...response, cachedAt: Date.now() });
};

export const GameSearch = ({ value, onChange, onSelect, selectedId, allowCreate, onCreate, includeRules = false, onRuleSelect }: Props) => {
  const inputId = useId();
  const query = useDebouncedValue(value.trim());
  const [games, setGames] = useState<GameSummary[]>([]);
  const [rules, setRules] = useState<RuleSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { canEdit } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!query || selectedId) { setGames([]); setRules([]); setSearchError(false); return; }
    const cacheKey = `${includeRules ? 'all' : 'games'}:${query.toLocaleLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_FRESH_MS) {
      setGames(cached.games); setRules(cached.rules); setActiveIndex(-1); setLoading(false); setSearchError(false);
      return;
    }
    if (cached) searchCache.delete(cacheKey);
    let active = true;
    setLoading(true);
    setSearchError(false);
    const request = includeRules ? api.search(query) : api.searchGames(query).then((result) => ({ ...result, rules: [] }));
    request.then((response) => {
      rememberSearch(cacheKey, response);
      if (active) { setGames(response.games); setRules(response.rules); setActiveIndex(-1); setSearchError(false); }
    }).catch(() => { if (active) { setGames([]); setRules([]); setSearchError(true); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [includeRules, query, selectedId]);

  const hasExactMatch = games.some(
    (g) =>
      g.displayName.toLowerCase() === query.toLowerCase() ||
      g.englishName?.toLowerCase() === query.toLowerCase()
  );
  
  const showCreateOption = Boolean(!loading && !searchError && query && (onCreate || !hasExactMatch));
  const optionCount = games.length + rules.length + (showCreateOption ? 1 : 0);

  const handleCreateOrLogin = () => {
    if (canEdit || onCreate) {
      if (onCreate) onCreate(query);
      else navigate(`/add?gameName=${encodeURIComponent(query)}`);
    } else {
      navigate(`/login?redirect=${encodeURIComponent(`/add?gameName=${encodeURIComponent(query)}`)}`);
    }
  };

  const chooseActive = () => {
    if (activeIndex < 0) return;
    if (activeIndex < games.length) onSelect(games[activeIndex]);
    else if (activeIndex < games.length + rules.length) onRuleSelect?.(rules[activeIndex - games.length]);
    else handleCreateOrLogin();
  };

  return <div className="game-search">
    <label htmlFor={inputId}>遊戲名稱</label>
    <div className={selectedId ? 'search-input selected' : 'search-input'}>
      <input id={inputId} value={value} onChange={(event) => onChange(event.target.value)}
        placeholder="搜尋遊戲名稱..." autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={!selectedId && (loading || searchError || optionCount > 0)} aria-controls={`${inputId}-results`}
        aria-activedescendant={activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && optionCount) { event.preventDefault(); setActiveIndex((index) => (index + 1) % optionCount); }
          if (event.key === 'ArrowUp' && optionCount) { event.preventDefault(); setActiveIndex((index) => index <= 0 ? optionCount - 1 : index - 1); }
          if (event.key === 'Enter') {
            event.preventDefault();
            if (activeIndex >= 0) {
              chooseActive();
            } else if (games.length === 1 && rules.length === 0) {
              onSelect(games[0]);
            } else if (games.length > 0) {
              onSelect(games[0]);
            } else if (rules.length > 0) {
              if (onRuleSelect) onRuleSelect(rules[0]);
            } else if (query) {
              handleCreateOrLogin();
            }
          }
          if (event.key === 'Escape') { setGames([]); setRules([]); setActiveIndex(-1); }
        }} />
      {selectedId && <span aria-hidden="true">✓</span>}
    </div>
    {!selectedId && (loading || searchError || (!loading && !searchError && games.length === 0 && rules.length === 0 && query) || optionCount > 0) && <div className="search-results" id={`${inputId}-results`} role="listbox">
      {loading && <p className="muted">尋找遊戲或規則中…</p>}
      {searchError && <p className="search-error">搜尋發生錯誤，請稍後重試</p>}
      {!loading && !searchError && games.length === 0 && rules.length === 0 && query && (
        <p className="empty-search-message">找不到相符的遊戲</p>
      )}
      {games.length > 0 && includeRules && <p className="result-group-label">遊戲</p>}
      {games.map((game, index) => <button type="button" id={`${inputId}-option-${index}`} aria-selected={activeIndex === index} key={game.id} onClick={() => onSelect(game)} role="option">
        <strong>{game.displayName}</strong>
        {game.englishName && <span>{game.englishName}</span>}
        <small>{game.ruleCount} 條規則</small>
      </button>)}
      {rules.length > 0 && <p className="result-group-label">規則內容</p>}
      {rules.map((rule, ruleIndex) => { const index = games.length + ruleIndex; return <button type="button" id={`${inputId}-option-${index}`} aria-selected={activeIndex === index} className="rule-result" key={rule.ruleId} onClick={() => onRuleSelect?.(rule)} role="option">
        <strong>{rule.gameName}</strong><span>{rule.statement}</span><small>查看規則 →</small>
      </button>; })}
      {showCreateOption && <button type="button" id={`${inputId}-option-${games.length + rules.length}`} aria-selected={activeIndex === games.length + rules.length} role="option" className="create-result" onClick={handleCreateOrLogin}>
        {(canEdit || onCreate) ? `＋ 新增「${query}」的第一條玩錯規則` : `🔒 登入後新增「${query}」的第一條玩錯規則`}
      </button>}
    </div>}
  </div>;
};

