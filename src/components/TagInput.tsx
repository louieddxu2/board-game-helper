import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import { detectDeterministicTags, type DetectionInput } from '../lib/tagDetector';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { TagSelection, TagSummary } from '../shared/types';
import zhTWCopy from '../content/zh-TW.json';

export const clearPublicTagCache = () => {
  void localDb.invalidatePublicTags().catch(() => undefined);
};

const selectionName = (selection: TagSelection) => selection.name.trim().toLocaleLowerCase();

const filterTags = (tags: TagSummary[], query: string, selected: TagSelection[]) => {
  const normalizedQuery = query.toLocaleLowerCase();
  const selectedIds = new Set(selected.flatMap((tag) => tag.id ? [tag.id] : []));
  const selectedNames = new Set(selected.map(selectionName));
  const matched = tags.filter((tag) => {
    if (selectedIds.has(tag.id) || selectedNames.has(tag.name.toLocaleLowerCase())) return false;
    if (!normalizedQuery) return true;
    return tag.name.toLocaleLowerCase().includes(normalizedQuery);
  });
  return Array.from(new Map(matched.map((tag) => [tag.id || tag.name.toLocaleLowerCase(), tag])).values());
};

export const getCommonTagSuggestions = (tags: TagSummary[], selected: TagSelection[], limit = 6): TagSummary[] => {
  const selectedNames = new Set(selected.map(selectionName));
  const counts = new Map<string, { tag: TagSummary; count: number }>();
  for (const tag of tags) {
    const key = tag.name.trim().toLocaleLowerCase();
    if (!key || selectedNames.has(key)) continue;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { tag, count: 1 });
  }
  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count
      || (right.tag.usageCount ?? 0) - (left.tag.usageCount ?? 0)
      || left.tag.name.localeCompare(right.tag.name, 'zh-Hant'))
    .slice(0, limit)
    .map(({ tag }) => tag);
};

interface TagInputProps {
  value: TagSelection[];
  onChange(value: TagSelection[]): void;
  canCreate?: boolean;
  label?: string;
  detectedSuggestions?: string[];
  availableTags?: TagSummary[];
  detectionInput?: DetectionInput;
}

export const TagInput = ({
  value,
  onChange,
  canCreate = true,
  label = '標籤',
  detectedSuggestions = [],
  availableTags,
  detectionInput,
}: TagInputProps) => {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const pendingCompositionEnterRef = useRef(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TagSummary[]>([]);
  const [publicTags, setPublicTags] = useState<TagSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [suggestionPosition, setSuggestionPosition] = useState<{ top: number; left: number; width: number }>();
  const debouncedQuery = useDebouncedValue(query.trim());

  useEffect(() => {
    let active = true;
    void api.tags(undefined, (updated) => { if (active) setPublicTags(updated.tags); }).then((result) => {
      if (active) setPublicTags(result.tags);
    }).catch(() => { if (active) setPublicTags([]); });
    return () => { active = false; };
  }, []);

  const candidateTags = useMemo(() => {
    const combined = [...(availableTags ?? []), ...publicTags];
    return Array.from(new Map(combined.map((tag) => [tag.name.trim().toLocaleLowerCase(), tag])).values());
  }, [availableTags, publicTags]);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current?.contains(event.target as Node) || suggestionsRef.current?.contains(event.target as Node)) return;
      if (containerRef.current) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSuggestions(filterTags(candidateTags, debouncedQuery, value));
  }, [candidateTags, debouncedQuery, open, value]);
  const add = (selection: TagSelection) => {
    const cleaned = selection.name.trim().replace(/^#/, '');
    if (!cleaned || value.some((selected) => (selection.id && selected.id === selection.id)
      || selectionName(selected) === cleaned.toLocaleLowerCase()) || value.length >= 6) return;
    onChange([...value, { ...selection, name: cleaned }]); setQuery(''); setOpen(false);
  };
  const commitQuery = (rawValue = query) => {
    const cleaned = rawValue.trim().replace(/^#/, '');
    if (!cleaned || value.some((tag) => selectionName(tag) === cleaned.toLocaleLowerCase()) || value.length >= 6) return;
    const exact = candidateTags.find((tag) => tag.name.toLocaleLowerCase() === cleaned.toLocaleLowerCase());
    if (exact) {
      add({ id: exact.id, name: exact.name });
    } else {
      add({ name: cleaned });
    }
  };

  const recommendations = useMemo(() => {
    const selectedNames = new Set(value.map(selectionName));
    const selectedNameValues = value.map((tag) => tag.name);
    const inferredFromText = detectionInput
      ? detectDeterministicTags(detectionInput, { gameTags: candidateTags }, selectedNameValues)
      : [];
    const detected = Array.from(new Map([...detectedSuggestions, ...inferredFromText]
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter((tag) => tag && !selectedNames.has(tag.toLocaleLowerCase()))
      .map((tag) => [tag.toLocaleLowerCase(), tag])).values()).slice(0, 6);
    const detectedNames = new Set(detected.map((name) => name.toLocaleLowerCase()));
    const common = getCommonTagSuggestions(availableTags ?? [], value)
      .filter((tag) => !detectedNames.has(tag.name.toLocaleLowerCase()));
    const commonNames = new Set(common.map((tag) => tag.name.toLocaleLowerCase()));
    const publicFallback = publicTags
      .filter((tag) => {
        const name = tag.name.toLocaleLowerCase();
        return !selectedNames.has(name) && !detectedNames.has(name) && !commonNames.has(name);
      })
      .sort((left, right) => (right.usageCount ?? 0) - (left.usageCount ?? 0)
        || left.name.localeCompare(right.name, 'zh-Hant'))
      .slice(0, 6);
    return { detected, common, publicFallback };
  }, [availableTags, candidateTags, detectedSuggestions, detectionInput, value]);
  const showRecommendations = value.length < 6 && (recommendations.detected.length > 0
    || recommendations.common.length > 0 || recommendations.publicFallback.length > 0);
  const hasSuggestionContent = suggestions.length > 0 || Boolean(canCreate && query.trim());
  const showSuggestions = open && hasSuggestionContent;

  const updateSuggestionPosition = useCallback(() => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 220), Math.max(0, window.innerWidth - 16));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    setSuggestionPosition({ top: rect.bottom + 5, left, width });
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const handleVisualViewportChange = () => {
      if (document.activeElement === inputRef.current && value.length < 6 && hasSuggestionContent) setOpen(true);
      updateSuggestionPosition();
    };
    if (showSuggestions) {
      updateSuggestionPosition();
      window.addEventListener('resize', updateSuggestionPosition);
      window.addEventListener('scroll', updateSuggestionPosition, true);
    }
    visualViewport?.addEventListener('resize', handleVisualViewportChange);
    visualViewport?.addEventListener('scroll', handleVisualViewportChange);
    return () => {
      window.removeEventListener('resize', updateSuggestionPosition);
      window.removeEventListener('scroll', updateSuggestionPosition, true);
      visualViewport?.removeEventListener('resize', handleVisualViewportChange);
      visualViewport?.removeEventListener('scroll', handleVisualViewportChange);
    };
  }, [hasSuggestionContent, showSuggestions, updateSuggestionPosition, value.length]);

  return <div className="tag-input" ref={containerRef}>
    <label htmlFor={id}>{label}</label>
    <div className="tag-composer">
      {value.map((tag) => <span className="tag-chip selected" key={tag.id ?? tag.name}>#{tag.name}<button type="button" aria-label={`移除標籤 ${tag.name}`} onClick={() => onChange(value.filter((item) => item !== tag))}>×</button></span>)}
      <input ref={inputRef} id={id} value={query} disabled={value.length >= 6} placeholder={value.length ? '再加一個…' : '搜尋時機、補牌、平手…'}
        role="combobox" aria-expanded={open} aria-controls={`${id}-list`} autoComplete="off" enterKeyHint="enter"
        onFocus={() => { setOpen(true); updateSuggestionPosition(); }} onPointerDown={() => { setOpen(true); updateSuggestionPosition(); }} onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (event.nativeEvent.isComposing) pendingCompositionEnterRef.current = true;
            else { pendingCompositionEnterRef.current = false; commitQuery(event.currentTarget.value); }
          }
          if (event.key === ',' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); commitQuery(event.currentTarget.value); }
          if (event.key === 'Escape') setOpen(false);
        }}
        onCompositionEnd={(event) => {
          if (!pendingCompositionEnterRef.current) return;
          pendingCompositionEnterRef.current = false;
          commitQuery(event.currentTarget.value);
        }} />
    </div>

    {showRecommendations && <div className="tag-recommendations">
      {recommendations.detected.length > 0 && <div className="tag-recommendation-group">
        <small>根據{zhTWCopy.terms.correctRule}</small>
        <div className="recommended-tag-chips">
          {recommendations.detected.map((tagName) => <button type="button" key={tagName} className="tag-chip inferred"
            aria-label={`加入標籤 ${tagName}`} onClick={() => {
              const known = candidateTags.find((tag) => tag.name.toLocaleLowerCase() === tagName.toLocaleLowerCase());
              add(known ? { id: known.id, name: known.name } : { name: tagName });
            }}>＋ #{tagName}</button>)}
        </div>
      </div>}
      {recommendations.common.length > 0 && <div className="tag-recommendation-group">
        <small>這款遊戲常用</small>
        <div className="recommended-tag-chips">
          {recommendations.common.map((tag) => <button type="button" key={tag.id || tag.name} className="tag-chip"
            aria-label={`加入標籤 ${tag.name}`} onClick={() => add({ id: tag.id, name: tag.name })}>＋ #{tag.name}</button>)}
        </div>
      </div>}
      {recommendations.publicFallback.length > 0 && <div className="tag-recommendation-group">
        <small>公共標籤</small>
        <div className="recommended-tag-chips">
          {recommendations.publicFallback.map((tag) => <button type="button" key={tag.id || tag.name} className="tag-chip"
            aria-label={`加入標籤 ${tag.name}`} onClick={() => add({ id: tag.id, name: tag.name })}>＋ #{tag.name}</button>)}
        </div>
      </div>}
    </div>}

    {showSuggestions && suggestionPosition && typeof document !== 'undefined' && createPortal(<div ref={suggestionsRef} className="tag-suggestions tag-suggestions-portal" style={{ top: suggestionPosition.top, left: suggestionPosition.left, width: suggestionPosition.width }} id={`${id}-list`} role="listbox">
      {suggestions.map((tag) => <button type="button" role="option" key={tag.id} onClick={() => add({ id: tag.id, name: tag.name })}>#{tag.name}{tag.usageCount !== undefined && <small>{tag.usageCount} 條</small>}</button>)}
      {canCreate && query.trim() && !suggestions.some((tag) => tag.name === query.trim()) && <button type="button" className="create-tag" onClick={() => add({ name: query })}>＋建立「{query.trim()}」</button>}
    </div>, document.body)}
  </div>;
};
