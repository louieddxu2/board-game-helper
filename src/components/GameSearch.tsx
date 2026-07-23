import { useEffect, useId, useState } from 'react';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { GameSummary, RuleSearchResult } from '../shared/types';

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
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    if (!query || selectedId) { setGames([]); setRules([]); return; }
    const cacheKey = `${includeRules ? 'all' : 'games'}:${query.toLocaleLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_FRESH_MS) {
      setGames(cached.games); setRules(cached.rules); setActiveIndex(-1); setLoading(false);
      return;
    }
    if (cached) searchCache.delete(cacheKey);
    let active = true;
    setLoading(true);
    const request = includeRules ? api.search(query) : api.searchGames(query).then((result) => ({ ...result, rules: [] }));
    request.then((response) => {
      rememberSearch(cacheKey, response);
      if (active) { setGames(response.games); setRules(response.rules); setActiveIndex(-1); }
    }).catch(() => { if (active) { setGames([]); setRules([]); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [includeRules, query, selectedId]);
  const canCreate = Boolean(!loading && games.length === 0 && allowCreate && query);
  const optionCount = games.length + rules.length + (canCreate ? 1 : 0);
  const chooseActive = () => {
    if (activeIndex < 0) return;
    if (activeIndex < games.length) onSelect(games[activeIndex]);
    else if (activeIndex < games.length + rules.length) onRuleSelect?.(rules[activeIndex - games.length]);
    else onCreate?.(value.trim());
  };
  return <div className="game-search">
    <label htmlFor={inputId}>玩了哪款遊戲？</label>
    <div className={selectedId ? 'search-input selected' : 'search-input'}>
      <input id={inputId} value={value} onChange={(event) => onChange(event.target.value)}
        placeholder={includeRules ? '搜尋遊戲，或輸入「平手」「補牌」' : '輸入中文名、英文名或別名'} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={!selectedId && (loading || optionCount > 0)} aria-controls={`${inputId}-results`}
        aria-activedescendant={activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && optionCount) { event.preventDefault(); setActiveIndex((index) => (index + 1) % optionCount); }
          if (event.key === 'ArrowUp' && optionCount) { event.preventDefault(); setActiveIndex((index) => index <= 0 ? optionCount - 1 : index - 1); }
          if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); chooseActive(); }
          if (event.key === 'Escape') { setGames([]); setRules([]); setActiveIndex(-1); }
        }} />
      {selectedId && <span aria-hidden="true">✓</span>}
    </div>
    {!selectedId && (loading || optionCount > 0) && <div className="search-results" id={`${inputId}-results`} role="listbox">
      {loading && <p className="muted">尋找遊戲中…</p>}
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
      {canCreate && <button type="button" id={`${inputId}-option-${games.length + rules.length}`} aria-selected={activeIndex === games.length + rules.length} role="option" className="create-result" onClick={() => onCreate?.(value.trim())}>
        ＋建立新遊戲「{value.trim()}」
      </button>}
    </div>}
  </div>;
};
