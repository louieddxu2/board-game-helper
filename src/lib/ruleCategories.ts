import { RULE_CATEGORIES, type RuleCard, type RuleCategory, type TagSummary } from '../shared/types';

export type RuleCategoryFilter = 'all' | RuleCategory;

const normalizedText = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

export const detectAutomaticRuleCategories = <T extends RuleCard>(
  rule: T,
  publicTags: TagSummary[],
): RuleCategory[] => {
  if (rule.categories?.length) return [];

  const detected = new Set<RuleCategory>();
  for (const tag of rule.tags) {
    for (const category of tag.categoryHints ?? []) detected.add(category);
  }

  const content = normalizedText([rule.statement, rule.commonMistake, rule.details]
    .filter((value): value is string => Boolean(value))
    .join(' '));
  if (content) {
    for (const tag of publicTags) {
      if (!(tag.categoryHints?.length && tag.detectionKeywords?.length)) continue;
      if (tag.detectionKeywords.some((keyword) => {
        const normalizedKeyword = normalizedText(keyword.trim());
        return normalizedKeyword.length > 0 && content.includes(normalizedKeyword);
      })) {
        for (const category of tag.categoryHints) detected.add(category);
      }
    }
  }

  return RULE_CATEGORIES.filter((category) => detected.has(category));
};

export const effectiveRuleCategories = <T extends RuleCard>(
  rule: T,
  publicTags: TagSummary[],
): RuleCategory[] => rule.categories?.length
  ? rule.categories
  : detectAutomaticRuleCategories(rule, publicTags);

export const filterRulesByCategory = <T extends RuleCard>(
  rules: T[],
  category: RuleCategoryFilter,
  publicTags: TagSummary[] = [],
): T[] => category === 'all'
  ? rules
  : rules.filter((rule) => effectiveRuleCategories(rule, publicTags).includes(category));
