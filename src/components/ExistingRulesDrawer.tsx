import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocalRuleFilters } from '../hooks/useRuleFilters';
import { closestDraft, type DraftRule } from '../lib/ruleSimilarity';
import type { RuleCard } from '../shared/types';
import { useWorkspaceBrowserBack } from '../workspace/useWorkspaceBrowserBack';
import { TagFilterRow } from './FilterRows';

const NO_CLASSIFICATION_TAGS: never[] = [];
/** A rightward swipe this far, and more sideways than up or down, closes the drawer. */
const SWIPE_CLOSE_DISTANCE = 60;
/** Below this many rules the tag row is enough; a search box would only take room. */
const SEARCH_FROM = 9;

/**
 * Lets a contributor look over the selected game's published rules without leaving the record page,
 * with rules that resemble what they are typing listed first. Uses the rules already loaded with the game.
 */
export const ExistingRulesDrawer = ({ open, gameName, rules, drafts, onClose }: {
  open: boolean;
  gameName: string;
  rules: RuleCard[];
  drafts: DraftRule[];
  onClose(): void;
}) => {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const swipeStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const filters = useLocalRuleFilters(rules, NO_CLASSIFICATION_TAGS);
  useWorkspaceBrowserBack({ active: open, onBack: onClose });

  // Focus the drawer within the opening tap, and hand focus back to the opener when it closes.
  useLayoutEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => previousFocus?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [open]);

  // Rules resembling a draft come first, closest first; the rest keep the importance order.
  const listed = useMemo(() => {
    const scored = filters.visibleRules.map((rule, order) => ({
      rule, order, match: closestDraft(rule.statement, rule.tags.map((tag) => tag.name), drafts),
    }));
    return scored.sort((left, right) => (right.match?.score ?? -1) - (left.match?.score ?? -1) || left.order - right.order);
  }, [filters.visibleRules, drafts]);

  if (!open) return null;
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return <div className="existing-rules-layer">
    {/* Closing on click, not on press, keeps the tap from also landing on the form underneath. */}
    <div className="existing-rules-backdrop" role="presentation" onClick={onClose} />
    <aside className="existing-rules-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onTouchStart={(event) => {
        const point = event.touches[0];
        swipeStart.current = event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : undefined;
      }}
      onTouchEnd={(event) => {
        const start = swipeStart.current;
        swipeStart.current = undefined;
        const point = event.changedTouches[0];
        if (!start || !point) return;
        const dx = point.clientX - start.x;
        if (dx > SWIPE_CLOSE_DISTANCE && dx > Math.abs(point.clientY - start.y)) onClose();
      }}
      onTouchCancel={() => { swipeStart.current = undefined; }}>
      <header className="existing-rules-header">
        <div className="existing-rules-title">
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>{gameName}・既有 {rules.length} 條規則</h2>
          <button type="button" className="existing-rules-close" aria-label="關閉" onClick={onClose}>✕</button>
        </div>
        <p className="existing-rules-hint">點一下展開完整內容；草稿不會離開這一頁</p>
        {rules.length >= SEARCH_FROM && <input type="search" className="existing-rules-search" value={filters.ruleQuery}
          onChange={(event) => filters.setRuleQuery(event.target.value)} placeholder="在既有規則中搜尋…" aria-label="在既有規則中搜尋" />}
        <TagFilterRow options={filters.tagOptions} hasActiveFilters={filters.hasActiveFilters} onToggle={filters.toggleTag} onClear={filters.clearAllFilters} />
      </header>
      <ul className="existing-rules-list">
        {listed.length === 0 && <li className="existing-rules-empty">沒有符合條件的規則。</li>}
        {listed.map(({ rule, match }) => <li key={rule.id}>
          <button type="button" className="existing-rule" aria-expanded={expanded.has(rule.id)} onClick={() => toggle(rule.id)}>
            {match && <span className="existing-rule-similar">可能與第 {match.draftIndex + 1} 條相似</span>}
            <span className="existing-rule-statement">{rule.statement}</span>
            {rule.tags.length > 0 && <span className="existing-rule-tags">{rule.tags.map((tag) => `#${tag.name}`).join(' ')}</span>}
          </button>
        </li>)}
      </ul>
    </aside>
  </div>;
};
