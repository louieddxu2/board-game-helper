import type { RuleCard } from '../shared/types';

export const sortRulesByImportance = <T extends RuleCard>(rules: T[]): T[] =>
  [...rules].sort((left, right) => (right.importanceCount ?? 0) - (left.importanceCount ?? 0));

export const applyRuleImportance = (
  ruleIds: string[],
  ruleId: string,
  important: boolean,
): string[] => {
  const result = new Set(ruleIds);
  if (important) result.add(ruleId);
  else result.delete(ruleId);
  return [...result].sort();
};

export const updateRuleImportanceCount = <T extends RuleCard>(
  rules: T[],
  ruleId: string,
  count: number,
): T[] => rules.map((rule) => rule.id === ruleId
  ? { ...rule, importanceCount: Math.max(0, count) }
  : rule);
