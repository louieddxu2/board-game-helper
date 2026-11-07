import { useRef } from 'react';
import type { RuleFilterState } from '../hooks/useRuleFilters';
import { RULE_CATEGORY_LABELS } from '../shared/types';
import { TagFilterRow, useScrollEndFade } from './FilterRows';

export const RuleFilters = ({ filters }: { filters: RuleFilterState }) => {
  const {
    activeEditions, activePlayerCounts, availableCategories, availableEditions, availablePlayerCounts,
    clearAllFilters, hasActiveFilters, ruleQuery, selectedCategory, setRuleQuery, tagOptions,
    toggleCategory, toggleEdition, togglePlayerCount, toggleTag,
  } = filters;
  const specialRef = useRef<HTMLDivElement>(null);
  useScrollEndFade(specialRef, `${availablePlayerCounts.join(',')}|${availableEditions.join('\u0000')}`);
  const hasSpecialOptions = availablePlayerCounts.length > 0 || availableEditions.length > 0;
  return <section className="rule-filters" aria-label="篩選規則">
    {/* 第一列：概念快速索引，再次點選可解除目前索引。 */}
    {availableCategories.length > 0 && <div className="rule-quick-index" role="group" aria-label="規則快速索引">
      {availableCategories.map((category) => <button
        type="button"
        aria-label={RULE_CATEGORY_LABELS[category]}
        aria-pressed={selectedCategory === category}
        className={selectedCategory === category ? 'active' : ''}
        key={category}
        onClick={() => toggleCategory(category)}
      >
        {RULE_CATEGORY_LABELS[category].replaceAll('、', '·')}
      </button>)}
    </div>}

    {/* 第二列：人數 / 版本，一列橫滑；已選的就地標示，不改變順序。 */}
    {hasSpecialOptions && (
      <div ref={specialRef} className="filter-row special-tag-filter" role="group" aria-label="依人數或版本篩選">
        {availablePlayerCounts.map((count) => {
          const isSelected = activePlayerCounts.includes(count);
          return (
            <button
              type="button"
              key={`player-${count}`}
              aria-pressed={isSelected}
              className={isSelected ? 'tag-chip active special-chip' : 'tag-chip special-chip'}
              onClick={() => togglePlayerCount(count)}
            >
              {isSelected ? '✓ ' : ''}👥 {count}人
            </button>
          );
        })}
        {availableEditions.map((edition) => {
          const isSelected = activeEditions.includes(edition);
          return (
            <button
              type="button"
              key={`edition-${edition}`}
              aria-pressed={isSelected}
              className={isSelected ? 'tag-chip active special-chip' : 'tag-chip special-chip'}
              onClick={() => toggleEdition(edition)}
            >
              {isSelected ? '✓ ' : ''}📦 {edition}
            </button>
          );
        })}
      </div>
    )}

    {/* 第三列：搜尋框 */}
    <div className="rule-search">
      <input
        type="search"
        value={ruleQuery}
        onChange={(event) => setRuleQuery(event.target.value)}
        placeholder="輸入關鍵字搜尋"
        aria-label="關鍵字搜尋"
      />
    </div>

    {/* 第四列：標籤，一列橫滑；有篩選時最前面是清除鈕，已選標籤在前，其餘依規則數排序。 */}
    <TagFilterRow options={tagOptions} hasActiveFilters={hasActiveFilters} onToggle={toggleTag} onClear={clearAllFilters} />
  </section>;
};
