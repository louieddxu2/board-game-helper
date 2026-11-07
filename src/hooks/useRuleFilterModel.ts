import { useMemo } from 'react';
import { getRuleEditions } from '../lib/editionOptions';
import { effectiveRuleCategories, filterRulesByCategory } from '../lib/ruleCategories';
import type { RuleFilterPatch, RuleFilterView } from '../lib/ruleFilterParams';
import { sortRulesByImportance } from '../lib/ruleImportance';
import { RULE_CATEGORIES, type RuleCard, type RuleCategory, type TagSummary } from '../shared/types';

export type TagOption = { name: string; count: number; selected: boolean };

const toggleValue = <T>(values: T[], value: T) => values.includes(value)
  ? values.filter((current) => current !== value)
  : [...values, value];

const tagCollator = new Intl.Collator('zh-Hant');

/** Orders the tag row: selected tags first in the order chosen, then by how many visible rules carry each tag. */
export const orderTagOptions = (visibleRules: RuleCard[], activeTags: string[], query: string): TagOption[] => {
  const counts = new Map<string, number>();
  visibleRules.forEach((rule) => new Set(rule.tags.map((tag) => tag.name)).forEach((name) => {
    if (!activeTags.includes(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }));
  const others = Array.from(counts, ([name, count]) => ({ name, count, selected: false }))
    .filter((option) => !query || option.name.toLocaleLowerCase().includes(query))
    .sort((left, right) => right.count - left.count || tagCollator.compare(left.name, right.name));
  return [...activeTags.map((name) => ({ name, count: visibleRules.length, selected: true })), ...others];
};

/**
 * The rule filter calculations, independent of where the filter state lives:
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

  const gameCategories = useMemo(() => new Set(rules
    .flatMap((rule) => effectiveRuleCategories(rule, classificationTags))), [rules, classificationTags]);
  const selectedCategory = view.category !== 'all' && gameCategories.has(view.category) ? view.category : 'all';

  const normalizedQuery = ruleQuery.trim().toLocaleLowerCase();
  const rulesByQuery = useMemo(() => {
    if (!normalizedQuery) return rules;
    return rules.filter((rule) => [
      rule.statement,
      rule.commonMistake,
      rule.details,
      ...(rule.playerCounts ? rule.playerCounts.map((c) => `${c}人`) : []),
      ...(rule.editionNotes ?? []),
      ...rule.tags.map((t) => t.name),
    ].join(' ').toLocaleLowerCase().includes(normalizedQuery));
  }, [rules, normalizedQuery]);

  const matchesSpecial = (rule: RuleCard) => {
    if (activePlayerCounts.length > 0) {
      const counts = rule.playerCounts ?? [];
      if (counts.length > 0 && !activePlayerCounts.some((c) => counts.includes(c))) return false;
    }
    if (activeEditions.length > 0) {
      const editions = getRuleEditions(rule);
      if (!activeEditions.some((e) => editions.includes(e))) return false;
    }
    return true;
  };
  const matchesTags = (rule: RuleCard) => activeTags.every((tagName) => rule.tags.some((tag) => tag.name === tagName));

  // Only offer an index that leads to rules under the other filters; keep the selected one so it can be cleared.
  const availableCategories = useMemo(() => {
    const reachable = new Set(rulesByQuery
      .filter((rule) => matchesSpecial(rule) && matchesTags(rule))
      .flatMap((rule) => effectiveRuleCategories(rule, classificationTags)));
    return RULE_CATEGORIES.filter((category) => category === selectedCategory || reachable.has(category));
  }, [rulesByQuery, activePlayerCounts, activeEditions, activeTags, classificationTags, selectedCategory]);

  const rulesByCategory = useMemo(
    () => filterRulesByCategory(rulesByQuery, selectedCategory, classificationTags),
    [rulesByQuery, selectedCategory, classificationTags],
  );
  const rulesBySpecial = useMemo(() => rulesByCategory.filter(matchesSpecial), [rulesByCategory, activePlayerCounts, activeEditions]);
  const visibleRules = useMemo(() => sortRulesByImportance(rulesBySpecial.filter(matchesTags)), [rulesBySpecial, activeTags]);

  const availablePlayerCounts = useMemo(() => {
    const all = new Set<number>();
    const valid = new Set<number>();
    rules.forEach((r) => r.playerCounts?.forEach((c) => all.add(c)));
    rulesByCategory.forEach((r) => r.playerCounts?.forEach((c) => valid.add(c)));
    return Array.from(all).sort((a, b) => a - b).filter((c) => activePlayerCounts.includes(c) || valid.has(c));
  }, [rules, rulesByCategory, activePlayerCounts]);

  const availableEditions = useMemo(() => {
    const all = new Set<string>();
    const valid = new Set<string>();
    rules.forEach((rule) => getRuleEditions(rule).forEach((edition) => all.add(edition)));
    rulesByCategory.forEach((rule) => getRuleEditions(rule).forEach((edition) => valid.add(edition)));
    return Array.from(all).sort().filter((e) => activeEditions.includes(e) || valid.has(e));
  }, [rules, rulesByCategory, activeEditions]);

  const tagOptions = useMemo(
    () => orderTagOptions(visibleRules, activeTags, normalizedQuery),
    [visibleRules, activeTags, normalizedQuery],
  );

  return {
    activeEditions,
    activePlayerCounts,
    activeTags,
    availableCategories,
    availableEditions,
    availablePlayerCounts,
    clearAllFilters,
    // The search box alone is not a filter to clear; it has its own field.
    hasActiveFilters: activeTags.length > 0 || activePlayerCounts.length > 0 || activeEditions.length > 0,
    ruleQuery,
    selectedCategory,
    setRuleQuery,
    tagOptions,
    toggleCategory,
    toggleEdition,
    togglePlayerCount,
    togglePlayerCounts,
    toggleTag,
    visibleRules,
  };
};

export type RuleFilterState = ReturnType<typeof useRuleFilterModel>;
