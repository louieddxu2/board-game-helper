import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { TagSummary } from '../shared/types';

interface TagInputProps {
  value: string[];
  onChange(value: string[]): void;
  canCreate?: boolean;
  label?: string;
  detectedSuggestions?: string[];
  gameId?: string;
}

export const TagInput = ({
  value,
  onChange,
  canCreate = true,
  label = '標籤',
  detectedSuggestions = [],
  gameId,
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
    void api.tags(debouncedQuery, gameId).then((result) => { if (active) setSuggestions(result.tags.filter((tag) => !value.includes(tag.name))); });
    return () => { active = false; };
  }, [debouncedQuery, gameId, open, value]);
  const add = (name: string) => {
    const cleaned = name.trim().replace(/^#/, '');
    if (!cleaned || value.includes(cleaned) || value.length >= 8) return;
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

  const unselectedDetected = detectedSuggestions.filter((tag) => !value.includes(tag));

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

    {/* 確信命中點亮區面板 */}
    {unselectedDetected.length > 0 && (
      <div className="detected-tags-panel">
        <small className="muted">內文提及的常用標籤：</small>
        <div className="detected-chips">
          {unselectedDetected.map((tagName) => (
            <button
              type="button"
              key={tagName}
              className="tag-chip light-up"
              onClick={() => add(tagName)}
              title="點擊新增此標籤"
            >
              ＋ #{tagName}
            </button>
          ))}
        </div>
      </div>
    )}

    {open && (suggestions.length > 0 || (canCreate && query.trim())) && <div className="tag-suggestions" id={`${id}-list`} role="listbox">
      {suggestions.map((tag) => <button type="button" role="option" key={tag.id} onClick={() => add(tag.name)}>#{tag.name}<small>{tag.usageCount ?? 0} 條</small></button>)}
      {canCreate && query.trim() && !suggestions.some((tag) => tag.name === query.trim()) && <button type="button" className="create-tag" onClick={() => add(query)}>＋建立「{query.trim()}」</button>}
    </div>}
  </div>;
};
