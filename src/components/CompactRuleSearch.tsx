import { useLayoutEffect, useRef } from 'react';
import type { RuleCard } from '../shared/types';

export function markRuleMatches(text: string, pattern?: RegExp) {
  if (!pattern) return text;
  return text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part);
}

/** Keep the original sentence around the first hit. A long sentence can also start at the hit. */
export function CompactRuleText({ text, pattern, sentenceOnly = false }: {
  text: string; pattern?: RegExp; sentenceOnly?: boolean;
}) {
  const match = pattern?.exec(text);
  if (!match) return <span className="compact-rule-text">{text}</span>;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const lead = before.match(/[^。！？.!?\n]*$/u)![0];
  const end = after.search(/[。！？.!?\n]/u);
  const sentenceEnd = end < 0 ? after.length : end + 1;
  const prefix = before.slice(0, before.length - lead.length);
  return <span className="compact-rule-text">
    {!sentenceOnly && prefix && <span className="match-earlier-sentences">{prefix}</span>}
    {lead && <span className="match-lead">{lead}</span>}
    <mark>{match[0]}</mark>{markRuleMatches(after.slice(0, sentenceEnd), pattern)}
    {!sentenceOnly && sentenceEnd < after.length && <span className="match-later-sentences">{markRuleMatches(after.slice(sentenceEnd), pattern)}</span>}
  </span>;
}

/** Measure actual clamped lines, since a hit can fit on desktop and be clipped on a phone. */
export function useCompactSearchExcerpt(pattern: RegExp | undefined, rule: RuleCard) {
  const cardRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !pattern || card.querySelector('.compact-rule-meta mark')) return;
    const rows = Array.from(card.querySelectorAll<HTMLElement>('.compact-rule-text')).filter(row => row.querySelector('mark'));
    if (!rows.length) return;
    const visibleHit = (row: HTMLElement) => {
      const bounds = row.getBoundingClientRect();
      return Array.from(row.querySelectorAll('mark')).some(mark => {
        const rects = Array.from(mark.getClientRects());
        return rects.length > 0 && rects.every(rect => rect.height > 0 && rect.bottom <= bounds.bottom + 1
          && rect.right <= bounds.right + 1 && rect.left >= bounds.left - 1);
      });
    };
    const reset = () => rows.forEach(row => { delete row.dataset.excerpt; });
    const measure = () => {
      reset();
      if (rows.some(visibleHit)) return;
      const first = rows[0];
      first.dataset.excerpt = 'sentence';
      if (!visibleHit(first)) first.dataset.excerpt = 'hit';
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(card);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      reset();
      observer?.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [pattern, rule]);
  return cardRef;
}
