import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { getRuleEditions } from '../lib/editionOptions';
import { effectiveRuleCategories, filterRulesByCategory } from '../lib/ruleCategories';
import { readRuleFilterParams, type RuleFilterPatch, writeRuleFilterParams } from '../lib/ruleFilterParams';
import { sortRulesByImportance } from '../lib/ruleImportance';
import { RULE_CATEGORIES, type RuleCard, type RuleCategory, type TagSummary } from '../shared/types';

const toggleValue = <T>(values: T[], value: T) => values.includes(value)
  ? values.filter((current) => current !== value)
  : [...values, value];

export const useRuleFilters = (rules: RuleCard[], classificationTags: TagSummary[]) => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const view = useMemo(() => readRuleFilterParams(params), [params]);
  const { tags: activeTags, playerCounts: activePlayerCounts, editions: activeEditions } = view;
  // The search box keeps its own text so typing never waits for a navigation.
  const [ruleQuery, setRuleQueryText] = useState(() => params.get('find') ?? '');
  useEffect(() => {
    // Filter updates replace the entry; pushed or traversed URLs (such as a search result) bring their own query.
    if (navigationType !== 'REPLACE') setRuleQueryText(params.get('find') ?? '');
  }, [location.key]);

  const updateView = (patch: RuleFilterPatch) => {
    const search = writeRuleFilterParams(params, patch).toString();
    // Keep the hash so a shared rule target stays in the link and the page does not scroll.
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state });
  };
  const setRuleQuery = (query: string) => {
    setRuleQueryText(query);
    updateView({ query });
  };
  const toggleCategory = (category: RuleCategory) => updateView({ category: selectedCategory === category ? 'all' : category });
  const toggleTag = (tag: string) => updateView({ tags: toggleValue(activeTags, tag) });
  const togglePlayerCount = (count: number) => updateView({ playerCounts: toggleValue(activePlayerCounts, count) });
  const togglePlayerCounts = (counts: number[]) => {
    const uniqueCounts = Array.from(new Set(counts));
    if (uniqueCounts.length === 0) return;
    const allSelected = uniqueCounts.every((count) => activePlayerCounts.includes(count));
    updateView({ playerCounts: allSelected
      ? activePlayerCounts.filter((count) => !uniqueCounts.includes(count))
      : Array.from(new Set([...activePlayerCounts, ...uniqueCounts])) });
  };
  const toggleEdition = (edition: string) => updateView({ editions: toggleValue(activeEditions, edition) });
  const clearAllFilters = () => {
    setRuleQueryText('');
    updateView({ tags: [], playerCounts: [], editions: [], query: '' });
  };

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

  const candidateUnselectedTags = useMemo(() => {
    const set = new Set<string>();
    visibleRules.forEach((rule) => rule.tags.forEach((t) => {
      if (!activeTags.includes(t.name)) set.add(t.name);
    }));
    const list = Array.from(set).sort();
    return (normalizedQuery ? list.filter((tag) => tag.toLocaleLowerCase().includes(normalizedQuery)) : list).slice(0, 6);
  }, [visibleRules, activeTags, normalizedQuery]);

  return {
    activeEditions,
    activePlayerCounts,
    activeTags,
    availableCategories,
    availableEditions,
    availablePlayerCounts,
    candidateUnselectedTags,
    clearAllFilters,
    ruleQuery,
    selectedCategory,
    setRuleQuery,
    toggleCategory,
    toggleEdition,
    togglePlayerCount,
    togglePlayerCounts,
    toggleTag,
    visibleRules,
  };
};

export type RuleFilterState = ReturnType<typeof useRuleFilters>;
