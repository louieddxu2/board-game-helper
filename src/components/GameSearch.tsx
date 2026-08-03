import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
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
  placeholder?: string;
}

type SearchResponse = { games: GameSummary[]; rules: RuleSearchResult[] };
export const clearSearchCache = () => {
  void api.invalidateSearchCache();
};

export function formatGameSearchDisplay(
  game: GameSummary,
  query: string
): { primary: string; secondary?: string } {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      primary: game.displayName,
      secondary: game.englishName,
    };
  }

  const normDisplayName = game.displayName.toLowerCase();
  const normEnglishName = game.englishName?.toLowerCase();

  if (normDisplayName.includes(q)) {
    return {
      primary: game.displayName,
      secondary: game.englishName,
    };
  }

  if (normEnglishName && normEnglishName.includes(q)) {
    return {
      primary: game.englishName!,
      secondary: game.displayName,
    };
  }

  const matchedAlias = game.aliases?.find((alias) => {
    const a = alias.trim();
    if (!a) return false;
    const normA = a.toLowerCase();
    if (normA === normDisplayName || normA === normEnglishName) return false;
    return normA.includes(q);
  });

  if (matchedAlias) {
    const secondaryName = game.englishName || game.displayName;
    return {
      primary: matchedAlias,
      secondary: secondaryName,
    };
  }

  return {
    primary: game.displayName,
    secondary: game.englishName,
  };
}

export const GameSearch = ({ value, onChange, onSelect, selectedId, allowCreate, onCreate, includeRules = false, onRuleSelect, placeholder = '搜尋遊戲名稱...' }: Props) => {
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const query = useDebouncedValue(value.trim());
  const [games, setGames] = useState<GameSummary[]>([]);
  const [rules, setRules] = useState<RuleSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number }>();
  const { canEdit } = useSession();
  const navigate = useNavigate();

  const isEnglishOnly = Boolean(query && /^[a-zA-Z0-9\s\-_'.]+$/.test(query));
  const isMinLengthSatisfied = isEnglishOnly ? query.length >= 2 : query.length >= 1;

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node) || resultsRef.current?.contains(event.target as Node)) return;
      if (containerRef.current) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  useEffect(() => {
    if (!query || selectedId || !isMinLengthSatisfied) {
      setGames([]); setRules([]); setSearchError(false); return;
    }
    let active = true;
    setLoading(true);
    setSearchError(false);
    
    const fetchApi = () => {
      const applyUpdated = (response: { games: GameSummary[]; rules: RuleSearchResult[] }) => {
        if (active) { setGames(response.games); setRules(response.rules); setActiveIndex(-1); setSearchError(false); }
      };
      const request = includeRules
        ? api.search(query, applyUpdated)
        : api.searchGames(query, (result) => applyUpdated({ ...result, rules: [] })).then((result) => ({ ...result, rules: [] }));
      request.then((response) => {
        if (active) { setGames(response.games); setRules(response.rules); setActiveIndex(-1); setSearchError(false); }
      }).catch(() => { if (active) { setGames([]); setRules([]); setSearchError(true); } }).finally(() => { if (active) setLoading(false); });
    };

    fetchApi();

    return () => { active = false; };
  }, [includeRules, isMinLengthSatisfied, query, selectedId]);

  const hasExactMatch = games.some(
    (g) =>
      g.displayName.toLowerCase() === query.toLowerCase() ||
      g.englishName?.toLowerCase() === query.toLowerCase() ||
      g.aliases?.some((a) => a.toLowerCase() === query.toLowerCase())
  );
  
  const showCreateOption = Boolean(allowCreate && (canEdit || onCreate))
    && Boolean(!loading && !searchError && query && isMinLengthSatisfied && (onCreate || !hasExactMatch));
  const optionCount = games.length + rules.length + (showCreateOption ? 1 : 0);
  const shouldShowResults = Boolean(
    open && !selectedId && ((isEnglishOnly && query.length === 1) || loading || searchError
      || (!loading && !searchError && games.length === 0 && rules.length === 0 && query) || optionCount > 0),
  );
  useEffect(() => {
    if (!shouldShowResults) return;
    const updatePosition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(rect.width, Math.max(0, window.innerWidth - 16));
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
      setMenuPosition({ top: rect.bottom + 8, left, width });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [shouldShowResults]);

  const handleCreateOrLogin = () => {
    if (canEdit || onCreate) {
      if (onCreate) onCreate(query);
      else navigate(`/add?name=${encodeURIComponent(query)}`);
    }
  };

  const chooseActive = () => {
    if (activeIndex < 0) return;
    if (activeIndex < games.length) onSelect(games[activeIndex]);
    else if (activeIndex < games.length + rules.length) onRuleSelect?.(rules[activeIndex - games.length]);
    else handleCreateOrLogin();
  };

  return <div className="game-search" ref={containerRef}>
    <div className={selectedId ? 'search-input selected' : 'search-input'}>
      <input ref={inputRef} id={inputId} value={value} onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        placeholder={placeholder} autoComplete="off" aria-label="搜尋遊戲名稱"
        role="combobox" aria-autocomplete="list" aria-expanded={shouldShowResults} aria-controls={`${inputId}-results`}
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
            } else if (query && showCreateOption) {
              handleCreateOrLogin();
            }
          }
          if (event.key === 'Escape') { setOpen(false); setActiveIndex(-1); }
        }} />
      {selectedId && <span aria-hidden="true">✓</span>}
    </div>
    {shouldShowResults && menuPosition && typeof document !== 'undefined' && createPortal(<div ref={resultsRef} className="search-results search-results-portal" style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }} id={`${inputId}-results`} role="listbox">
      {isEnglishOnly && query.length === 1 && (
        <p className="search-hint muted" style={{ padding: '0.5rem 0.75rem', margin: 0, fontSize: '0.875rem' }}>
          請輸入至少 2 個英文字母進行搜尋
        </p>
      )}
      {loading && <p className="muted">尋找遊戲中…</p>}
      {searchError && <p className="search-error">搜尋發生錯誤，請稍後重試</p>}
      {!loading && !searchError && !(isEnglishOnly && query.length === 1) && games.length === 0 && rules.length === 0 && query && (
        <p className="empty-search-message">找不到相符的遊戲</p>
      )}
      {games.length > 0 && includeRules && <p className="result-group-label">遊戲</p>}
      {games.map((game, index) => {
        const display = formatGameSearchDisplay(game, query);
        return (
          <button type="button" id={`${inputId}-option-${index}`} aria-selected={activeIndex === index} key={game.id} onClick={() => onSelect(game)} role="option">
            <strong>{display.primary}</strong>
            {display.secondary && <span>({display.secondary})</span>}
          </button>
        );
      })}
      {rules.length > 0 && <p className="result-group-label">正確規則</p>}
      {rules.map((rule, ruleIndex) => { const index = games.length + ruleIndex; return <button type="button" id={`${inputId}-option-${index}`} aria-selected={activeIndex === index} className="rule-result" key={rule.ruleId} onClick={() => onRuleSelect?.(rule)} role="option">
        <strong>{rule.gameName}</strong><span>{rule.statement}</span><small>查看規則 →</small>
      </button>; })}
      {showCreateOption && <button type="button" id={`${inputId}-option-${games.length + rules.length}`} aria-selected={activeIndex === games.length + rules.length} role="option" className="create-result" onClick={handleCreateOrLogin}>
        ＋ 新增「{query}」的第一條玩錯規則
      </button>}
    </div>, document.body)}
  </div>;
};
