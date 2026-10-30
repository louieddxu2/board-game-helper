import type { RuleFilterState } from '../hooks/useRuleFilters';
import { RULE_CATEGORY_LABELS } from '../shared/types';

export const RuleFilters = ({ filters }: { filters: RuleFilterState }) => {
  const {
    activeEditions, activePlayerCounts, activeTags, availableCategories, availableEditions, availablePlayerCounts,
    candidateUnselectedTags, clearAllFilters, ruleQuery, selectedCategory, setRuleQuery,
    toggleCategory, toggleEdition, togglePlayerCount, toggleTag,
  } = filters;
  const hasSpecialOptions = availablePlayerCounts.length > 0 || availableEditions.length > 0;
  const hasActiveFilters = activeTags.length > 0 || activePlayerCounts.length > 0 || activeEditions.length > 0;
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

    {/* 第二列：人數 / 版本 特殊 Tag (若有) */}
    {hasSpecialOptions && (
      <div className="special-tag-filter" aria-label="依人數或版本篩選">
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

    {/* 第四列：已選取的 Tag (獨立成一行) */}
    {hasActiveFilters && (
      <div className="selected-tags-row" aria-label="已選標籤">
        <span className="selected-tags-label">已選：</span>
        {activePlayerCounts.map((count) => (
          <button type="button" key={`sel-player-${count}`} className="tag-chip active" onClick={() => togglePlayerCount(count)}>
            👥 {count}人 ✕
          </button>
        ))}
        {activeEditions.map((edition) => (
          <button type="button" key={`sel-edition-${edition}`} className="tag-chip active" onClick={() => toggleEdition(edition)}>
            📦 {edition} ✕
          </button>
        ))}
        {activeTags.map((tag) => (
          <button type="button" key={`sel-tag-${tag}`} className="tag-chip active" onClick={() => toggleTag(tag)}>
            #{tag} ✕
          </button>
        ))}
        <button type="button" className="clear-tags-btn" onClick={clearAllFilters}>
          清除篩選 ✕
        </button>
      </div>
    )}

    {/* 第五列：剩餘標籤 Tag (上限 6 個，隨搜尋文字與目前相容規則過濾) */}
    {candidateUnselectedTags.length > 0 && (
      <div className="tag-filter" aria-label="候選標籤">
        {candidateUnselectedTags.map((tag) => (
          <button type="button" className="tag-chip" key={tag} onClick={() => toggleTag(tag)}>
            #{tag}
          </button>
        ))}
      </div>
    )}
  </section>;
};
