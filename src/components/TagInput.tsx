import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { TagSummary } from '../shared/types';

let publicTagsPromise: Promise<TagSummary[]> | undefined;

const loadPublicTags = async (): Promise<TagSummary[]> => {
  const result = await api.tags();
  return result.tags;
};

const getPublicTags = () => {
  publicTagsPromise ??= loadPublicTags().finally(() => { publicTagsPromise = undefined; });
  return publicTagsPromise;
};

export const clearPublicTagCache = () => {
  publicTagsPromise = undefined;
  void localDb.invalidatePublicTags().catch(() => undefined);
};

const filterTags = (tags: TagSummary[], query: string, selected: string[]) => {
  const normalizedQuery = query.toLocaleLowerCase();
  const selectedNames = new Set(selected.map((name) => name.toLocaleLowerCase()));
  const matched = tags.filter((tag) => {
    if (selectedNames.has(tag.name.toLocaleLowerCase())) return false;
    if (!normalizedQuery) return true;
    return [tag.name, ...(tag.aliases ?? [])].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
  return Array.from(new Map(matched.map((tag) => [tag.id || tag.name.toLocaleLowerCase(), tag])).values());
};

export const getCommonTagSuggestions = (tags: TagSummary[], selected: string[], limit = 6): TagSummary[] => {
  const selectedNames = new Set(selected.map((name) => name.toLocaleLowerCase()));
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
  value: string[];
  onChange(value: string[]): void;
  canCreate?: boolean;
  label?: string;
  detectedSuggestions?: string[];
  availableTags?: TagSummary[];
}

export const TagInput = ({
  value,
  onChange,
  canCreate = true,
  label = '標籤',
  detectedSuggestions = [],
  availableTags,
}: TagInputProps) => {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TagSummary[]>([]);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query.trim());

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
    let active = true;
    if (availableTags) {
      setSuggestions(filterTags(availableTags, debouncedQuery, value));
      return () => { active = false; };
    }
    void getPublicTags().then((tags) => {
      if (active) setSuggestions(filterTags(tags, debouncedQuery, value));
    }).catch(() => { if (active) setSuggestions([]); });
    return () => { active = false; };
  }, [availableTags, debouncedQuery, open, value]);
  const add = (name: string) => {
    const cleaned = name.trim().replace(/^#/, '');
    if (!cleaned || value.some((selected) => selected.toLocaleLowerCase() === cleaned.toLocaleLowerCase()) || value.length >= 8) return;
    onChange([...value, cleaned]); setQuery(''); setOpen(false);
  };
  const commitQuery = () => {
    const cleaned = query.trim().replace(/^#/, '');
    if (!cleaned || value.includes(cleaned) || value.length >= 8) return;
    const exact = suggestions.find((tag) => tag.name.toLocaleLowerCase() === cleaned.toLocaleLowerCase());
    if (exact) {
      add(exact.name);
    } else {
      add(cleaned);
    }
  };

  const recommendations = useMemo(() => {
    const selectedNames = new Set(value.map((name) => name.toLocaleLowerCase()));
    const detected = Array.from(new Map(detectedSuggestions
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter((tag) => tag && !selectedNames.has(tag.toLocaleLowerCase()))
      .map((tag) => [tag.toLocaleLowerCase(), tag])).values()).slice(0, 6);
    const detectedNames = new Set(detected.map((name) => name.toLocaleLowerCase()));
    const common = getCommonTagSuggestions(availableTags ?? [], value)
      .filter((tag) => !detectedNames.has(tag.name.toLocaleLowerCase()));
    return { detected, common };
  }, [availableTags, detectedSuggestions, value]);
  const showRecommendations = value.length < 8 && (recommendations.detected.length > 0 || recommendations.common.length > 0);

  return <div className="tag-input" ref={containerRef}>
    <label htmlFor={id}>{label}</label>
    <div className="tag-composer">
      {value.map((name) => <span className="tag-chip selected" key={name}>#{name}<button type="button" aria-label={`移除標籤 ${name}`} onClick={() => onChange(value.filter((item) => item !== name))}>×</button></span>)}
      <input id={id} value={query} disabled={value.length >= 8} placeholder={value.length ? '再加一個…' : '搜尋時機、補牌、平手…'}
        role="combobox" aria-expanded={open} aria-controls={`${id}-list`} autoComplete="off"
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ',') && !event.nativeEvent.isComposing) { event.preventDefault(); commitQuery(); }
          if (event.key === 'Escape') setOpen(false);
        }} />
    </div>

    {showRecommendations && <div className="tag-recommendations">
      {recommendations.detected.length > 0 && <div className="tag-recommendation-group">
        <small>根據規則內容</small>
        <div className="recommended-tag-chips">
          {recommendations.detected.map((tagName) => <button type="button" key={tagName} className="tag-chip inferred"
            aria-label={`加入標籤 ${tagName}`} onClick={() => add(tagName)}>＋ #{tagName}</button>)}
        </div>
      </div>}
      {recommendations.common.length > 0 && <div className="tag-recommendation-group">
        <small>這款遊戲常用</small>
        <div className="recommended-tag-chips">
          {recommendations.common.map((tag) => <button type="button" key={tag.id || tag.name} className="tag-chip"
            aria-label={`加入標籤 ${tag.name}`} onClick={() => add(tag.name)}>＋ #{tag.name}</button>)}
        </div>
      </div>}
    </div>}

    {open && (suggestions.length > 0 || (canCreate && query.trim())) && <div className="tag-suggestions" id={`${id}-list`} role="listbox">
      {suggestions.map((tag) => <button type="button" role="option" key={tag.id} onClick={() => add(tag.name)}>#{tag.name}{tag.usageCount !== undefined && <small>{tag.usageCount} 條</small>}</button>)}
      {canCreate && query.trim() && !suggestions.some((tag) => tag.name === query.trim()) && <button type="button" className="create-tag" onClick={() => add(query)}>＋建立「{query.trim()}」</button>}
    </div>}
  </div>;
};
