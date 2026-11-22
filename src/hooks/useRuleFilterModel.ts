import { useMemo } from 'react';
import type { RuleFilterPatch, RuleFilterView } from '../lib/ruleFilterParams';
import { sortRulesByImportance } from '../lib/ruleImportance';
import { computeRuleFilter } from '../shared/ruleFilter';
import type { RuleCard, RuleCategory, TagSummary } from '../shared/types';

// The calculations live in the rule filter shared with the score pad app.
export { orderTagOptions, type TagOption } from '../shared/ruleFilter';

const toggleValue = <T>(values: T[], value: T) => values.includes(value)
  ? values.filter((current) => current !== value)
  : [...values, value];

/**
 * The rule filter, independent of where the filter state lives:
 * the game page keeps it in the URL, the record page's drawer in component state.
 */
export const useRuleFilterModel = (
  rules: RuleCard[],
  classificationTags: TagSummary[],
  view: RuleFilterView,
  ruleQuery: string,
  applyPatch: (patch: RuleFilterPatch) => void,
) => {
  const { tags: activeTags, playerCounts: activePlayerCounts, editions: activeEditions } = view;
  const filter = useMemo(
    () => computeRuleFilter(rules, classificationTags, view, ruleQuery),
    [rules, classificationTags, view.category, activeTags, activePlayerCounts, activeEditions, ruleQuery],
  );
  // The site shows the most important rules first; the shared filter keeps the game's order.
  const visibleRules = useMemo(() => sortRulesByImportance(filter.filteredRules), [filter.filteredRules]);
  const { selectedCategory } = filter;

  const setRuleQuery = (query: string) => applyPatch({ query });
  const toggleCategory = (category: RuleCategory) => applyPatch({ category: selectedCategory === category ? 'all' : category });
  const toggleTag = (tag: string) => applyPatch({ tags: toggleValue(activeTags, tag) });
  const togglePlayerCount = (count: number) => applyPatch({ playerCounts: toggleValue(activePlayerCounts, count) });
  const togglePlayerCounts = (counts: number[]) => {
    const uniqueCounts = Array.from(new Set(counts));
    if (uniqueCounts.length === 0) return;
    const allSelected = uniqueCounts.every((count) => activePlayerCounts.includes(count));
    applyPatch({ playerCounts: allSelected
      ? activePlayerCounts.filter((count) => !uniqueCounts.includes(count))
      : Array.from(new Set([...activePlayerCounts, ...uniqueCounts])) });
  };
  const toggleEdition = (edition: string) => applyPatch({ editions: toggleValue(activeEditions, edition) });
  const clearAllFilters = () => applyPatch({ tags: [], playerCounts: [], editions: [], query: '' });

  return {
    activeEditions,
    activePlayerCounts,
    activeTags,
    availableCategories: filter.availableCategories,
    availableEditions: filter.availableEditions,
    availablePlayerCounts: filter.availablePlayerCounts,
    clearAllFilters,
    clearPlayerCounts: () => applyPatch({ playerCounts: [] }),
    hasActiveFilters: filter.hasActiveFilters,
    ruleQuery,
    matches: filter.matches,
    selectedCategory,
    setRuleQuery,
    tagOptions: filter.tagOptions,
    toggleCategory,
    toggleEdition,
    togglePlayerCount,
    togglePlayerCounts,
    toggleTag,
    visibleRules,
  };
};

export type RuleFilterState = ReturnType<typeof useRuleFilterModel>;
