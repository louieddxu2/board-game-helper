import type { RuleCard, RuleCategory } from '../shared/types';

export type RuleCategoryFilter = 'all' | RuleCategory;

export const filterRulesByCategory = <T extends RuleCard>(
  rules: T[],
  category: RuleCategoryFilter,
): T[] => category === 'all'
  ? rules
  : rules.filter((rule) => rule.categories?.includes(category));
