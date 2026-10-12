import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { GameSummary, RuleSearchResult } from '../shared/types';
import { useSession } from '../context/SessionContext';
import { useNavigate } from 'react-router-dom';
import zhTWCopy from '../content/zh-TW.json';
interface Props {
  value: string;
  onChange(value: string): void;
  onSelect(game: GameSummary): void;
  selectedId?: string;
  allowCreate?: boolean;
  onCreate?(name: string): void;
  includeRules?: boolean;
  includeGamesWithoutPublishedRules?: boolean;
  onRuleSelect?(rule: RuleSearchResult): void;
  placeholder?: string;
  /** Keeps results in flow for a modal; the default keeps the shared floating portal. */
  inlineResults?: boolean;
  emptyResults?: ReactNode;
  clearable?: boolean;
}
type SearchResponse = {
  games: GameSummary[];
  rules: RuleSearchResult[];
};
export const clearSearchCache = () => { void api.invalidateSearchCache(); };
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

export const GameSearch = ({ value, onChange, onSelect, selectedId, allowCreate, onCreate, includeRules = false, includeGamesWithoutPublishedRules = false, onRuleSelect, placeholder = '搜尋遊戲名稱...', inlineResults = false, emptyResults, clearable = false }: Props) => {
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const rawQuery = value.trim();
  const query = useDebouncedValue(rawQuery);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [rules, setRules] = useState<RuleSearchResult[]>([]);
  const [resultQuery, setResultQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
  }>();
  const { canEdit } = useSession();
  const navigate = useNavigate();
  const isEnglishOnly = /^[a-zA-Z0-9\s\-_'.]+$/.test(rawQuery);
  const meetsMinimum = isEnglishOnly ? rawQuery.length >= 2 : rawQuery.length >= 1;
  const isCurrentQuery = query === rawQuery;
  const waitingForDebounce = Boolean(rawQuery && !isCurrentQuery);
  const hasCurrentResults = Boolean(rawQuery && isCurrentQuery && resultQuery === rawQuery);
  const visibleGames = hasCurrentResults ? games : [];
  const visibleRules = hasCurrentResults ? rules : [];
  const visibleError = hasCurrentResults && searchError;
  const visibleLoading = Boolean(rawQuery && meetsMinimum
    && (waitingForDebounce || loading || (!hasCurrentResults && !visibleError)));
  useEffect(() => {
    if (!rawQuery) {
      setGames([]);
      setRules([]);
      setLoading(false);
      setSearchError(false);
      setActiveIndex(-1);
    }
  }, [rawQuery]);
  useEffect(() => {
    const minimum = /^[a-zA-Z0-9\s\-_'.]+$/.test(query) ? query.length >= 2 : query.length >= 1;
    if (!query || selectedId || !minimum) {
      setGames([]);
      setRules([]);
      setLoading(false);
      setSearchError(false);
      return;
    }
    let active = true;
    setLoading(true);
    setSearchError(false);
    const apply = (response: SearchResponse) => {
      if (active) {
        setGames(response.games);
        setRules(response.rules);
        setResultQuery(query);
        setActiveIndex(-1);
        setSearchError(false);
      }
    };
    const request = includeRules ? api.search(query, apply) : api.searchGames(query, (result) => apply({ ...result, rules: [] }), { includeGamesWithoutPublishedRules }).then((result) => ({ ...result, rules: [] }));
    request.then(apply).catch(() => {
      if (active) {
        setGames([]);
        setRules([]);
        setResultQuery(query);
        setSearchError(true);
      }
    }).finally(() => {
      if (active)
        setLoading(false);
    });
    return () => { active = false; };
  }, [includeGamesWithoutPublishedRules, includeRules, query, selectedId]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!inlineResults && !containerRef.current?.contains(event.target as Node) && !resultsRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [inlineResults]);
  const hasExactMatch = visibleGames.some((game) => game.displayName.toLowerCase() === rawQuery.toLowerCase() || game.englishName?.toLowerCase() === rawQuery.toLowerCase() || game.aliases?.some((alias) => alias.toLowerCase() === rawQuery.toLowerCase()));
  const showCreateOption = Boolean(allowCreate && (canEdit || onCreate) && !visibleLoading && !visibleError && rawQuery && meetsMinimum && isCurrentQuery && (onCreate || !hasExactMatch));
  const optionCount = visibleGames.length + visibleRules.length + (showCreateOption ? 1 : 0);
  const canShowResults = Boolean(!selectedId && rawQuery);
  const shouldShowResults = open && canShowResults;
  const updateMenuPosition = useCallback(() => {
    if (inlineResults)
      return;
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect)
      return;
    const width = Math.min(rect.width, Math.max(0, window.innerWidth - 16));
    setMenuPosition({ top: rect.bottom + 8, left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)), width });
  }, [inlineResults]);
  useEffect(() => {
    if (inlineResults)
      return;
    const viewport = window.visualViewport;
    const handleViewport = () => {
      if (document.activeElement === inputRef.current && canShowResults) setOpen(true);
      updateMenuPosition();
    };
    if (!inlineResults && shouldShowResults) {
      updateMenuPosition();
      window.addEventListener('resize', updateMenuPosition);
      window.addEventListener('scroll', updateMenuPosition, true);
    }
    viewport?.addEventListener('resize', handleViewport);
    viewport?.addEventListener('scroll', handleViewport);
    return () => { window.removeEventListener('resize', updateMenuPosition); window.removeEventListener('scroll', updateMenuPosition, true); viewport?.removeEventListener('resize', handleViewport); viewport?.removeEventListener('scroll', handleViewport); };
  }, [canShowResults, inlineResults, shouldShowResults, updateMenuPosition]);
  useEffect(() => {
    if (inlineResults && typeof resultsRef.current?.scrollTo === 'function')
      resultsRef.current.scrollTo({ top: 0, behavior: 'auto' });
  }, [inlineResults, rawQuery]);
  useEffect(() => {
    const activeOption = activeIndex >= 0 ? document.getElementById(`${inputId}-option-${activeIndex}`) : undefined;
    if (typeof activeOption?.scrollIntoView === 'function')
      activeOption.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, inputId]);
  const handleCreate = () => {
    if (canEdit || onCreate)
      onCreate ? onCreate(rawQuery) : navigate(`/add?name=${encodeURIComponent(rawQuery)}`);
  };
  const chooseActive = () => {
    if (activeIndex < 0) return;
    if (activeIndex < visibleGames.length) return onSelect(visibleGames[activeIndex]);
    if (activeIndex < visibleGames.length + visibleRules.length) {
      return onRuleSelect?.(visibleRules[activeIndex - visibleGames.length]);
    }
    handleCreate();
  };
  const results = <div ref={resultsRef} className={`search-results${inlineResults ? ' search-results-inline' : ' search-results-portal'}`} style={inlineResults ? undefined : menuPosition} id={`${inputId}-results`} role={shouldShowResults ? 'listbox' : undefined}>
    {!rawQuery && inlineResults && emptyResults}
    {rawQuery && inlineResults && !open && <p className="muted">繼續輸入以搜尋</p>}
    {(!inlineResults || open) && <>
      {rawQuery && isEnglishOnly && rawQuery.length === 1 && <p className="search-hint muted">請輸入至少 2 個英文字母進行搜尋</p>}
      {visibleLoading && <p className="muted">尋找遊戲中…</p>}{visibleError && <p className="search-error">搜尋發生錯誤，請稍後重試</p>}
      {rawQuery && !visibleLoading && !visibleError && !(isEnglishOnly && rawQuery.length === 1) && !visibleGames.length && !visibleRules.length && <p className="empty-search-message">找不到相符的遊戲</p>}
      {visibleGames.length > 0 && includeRules && <p className="result-group-label">遊戲</p>}
      {visibleGames.map((game, index) => { const display = formatGameSearchDisplay(game, rawQuery); return <button type="button" id={`${inputId}-option-${index}`} aria-selected={activeIndex === index} key={game.id} onClick={() => onSelect(game)} role="option" tabIndex={-1}><strong>{display.primary}</strong>{display.secondary && <span>({display.secondary})</span>}</button>; })}
      {visibleRules.length > 0 && <p className="result-group-label">{zhTWCopy.terms.correctRule}</p>}
      {visibleRules.map((rule, ruleIndex) => { const index = visibleGames.length + ruleIndex; return <button type="button" id={`${inputId}-option-${index}`} aria-selected={activeIndex === index} className="rule-result" key={rule.ruleId} onClick={() => onRuleSelect?.(rule)} role="option" tabIndex={-1}><strong>{rule.gameName}</strong><span>{rule.statement}</span><small>查看規則 →</small></button>; })}
      {showCreateOption && <button type="button" id={`${inputId}-option-${visibleGames.length + visibleRules.length}`} aria-selected={activeIndex === visibleGames.length + visibleRules.length} role="option" tabIndex={-1} className="create-result" onClick={handleCreate}>＋ 新增「{rawQuery}」的第一條玩錯規則</button>}
    </>}
  </div>;
  return <div className={`game-search${inlineResults ? ' game-search-inline' : ''}`} ref={containerRef}>
    <div className={selectedId ? 'search-input selected' : 'search-input'}><input ref={inputRef} id={inputId} value={value} onFocus={() => { setOpen(true); updateMenuPosition(); }} onPointerDown={() => { setOpen(true); updateMenuPosition(); }} onChange={(event) => { onChange(event.target.value); setActiveIndex(-1); setOpen(true); }} placeholder={placeholder} autoComplete="off" aria-label="搜尋遊戲名稱" role="combobox" aria-autocomplete="list" aria-expanded={shouldShowResults} aria-controls={shouldShowResults ? `${inputId}-results` : undefined} aria-activedescendant={shouldShowResults && activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' && optionCount) {
        event.preventDefault();
        setOpen(true);
        setActiveIndex((index) => open ? (index + 1) % optionCount : 0);
      }
      else if (event.key === 'ArrowUp' && optionCount) {
        event.preventDefault();
        setOpen(true);
        setActiveIndex((index) => !open || index <= 0 ? optionCount - 1 : index - 1);
      }
      else if (event.key === 'Enter') {
        event.preventDefault();
        if (!shouldShowResults)
          return;
        if (activeIndex >= 0)
          chooseActive();
        else if (visibleGames[0])
          onSelect(visibleGames[0]);
        else if (visibleRules[0])
          onRuleSelect?.(visibleRules[0]);
        else if (showCreateOption)
          handleCreate();
      }
      else if (event.key === 'Escape' && shouldShowResults && inlineResults) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
      }
      else if (event.key === 'Escape') {
        setOpen(false);
        setActiveIndex(-1);
      }
    }} />{clearable && value && <button type="button" className="search-input-clear" aria-label="清除搜尋" onPointerDown={(event) => event.preventDefault()} onClick={() => { onChange(''); inputRef.current?.focus(); }}>×</button>}{selectedId && <span aria-hidden="true">✓</span>}</div>
    {inlineResults ? results : shouldShowResults && menuPosition && typeof document !== 'undefined' && createPortal(results, document.body)}
  </div>;
};
