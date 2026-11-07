import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { TagOption } from '../hooks/useRuleFilterModel';

/** Marks a one-line scroll row when it is scrolled to its end, so the fade hinting at more items can drop. */
export const useScrollEndFade = (ref: RefObject<HTMLElement | null>, contentKey: string) => {
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const update = () => { row.dataset.atEnd = String(row.scrollLeft + row.clientWidth >= row.scrollWidth - 1); };
    update();
    row.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(row);
    return () => {
      row.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref, contentKey]);
};

/**
 * One swipeable row of topic tags: an icon-only clear button while any filter is on, the selected
 * tags in the order chosen, then the rest by how many of the shown rules carry them.
 */
export const TagFilterRow = ({ options, hasActiveFilters, onToggle, onClear }: {
  options: TagOption[];
  hasActiveFilters: boolean;
  onToggle(name: string): void;
  onClear(): void;
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const selectedKey = options.filter((option) => option.selected).map((option) => option.name).join('\u0000');
  const previousSelected = useRef(selectedKey);
  useScrollEndFade(rowRef, options.map((option) => option.name).join('\u0000'));
  // A tag that moves to the front on selection stays in sight: the row glides back to its start.
  useEffect(() => {
    if (previousSelected.current === selectedKey) return;
    previousSelected.current = selectedKey;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    rowRef.current?.scrollTo?.({ left: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [selectedKey]);

  if (options.length === 0 && !hasActiveFilters) return null;
  return <div ref={rowRef} className="filter-row tag-filter" role="group" aria-label="依標籤篩選">
    {hasActiveFilters && <button type="button" className="filter-clear" aria-label="清除所有篩選" onClick={onClear}>
      <span aria-hidden="true">✕</span>
    </button>}
    {options.map((option) => <button
      type="button"
      key={option.name}
      aria-pressed={option.selected}
      className={option.selected ? 'tag-chip active' : 'tag-chip'}
      onClick={() => onToggle(option.name)}
    >#{option.name}{option.selected ? ' ✕' : ''}</button>)}
  </div>;
};
