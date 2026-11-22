/**
 * Rule filtering shared with the score pad app: search, categories, tags, player counts and editions.
 *
 * The score pad keeps an exact copy of this file and of `ruleTypes.ts`, its only import, so both
 * apps filter a game's rules the same way. `scripts/shared-rule-filter.test.ts` records their hash;
 * after changing either file, copy both to the score pad and update the hash in both projects.
 * Sorting is left to each app.
 */
import { RULE_CATEGORIES, type RuleCategory } from './ruleTypes';

export type FilterableTag = { name: string; categoryHints?: RuleCategory[]; detectionKeywords?: string[] };

export type FilterableRule = {
  statement: string;
  commonMistake?: string;
  details?: string;
  categories?: RuleCategory[];
  playerCounts?: number[];
  editionNotes?: string[];
  editionNote?: string;
  tags: FilterableTag[];
};

export type RuleCategoryFilter = 'all' | RuleCategory;

export type RuleFilterView = {
  category: RuleCategoryFilter;
  tags: string[];
  playerCounts: number[];
  editions: string[];
};

export type TagOption = { name: string; count: number; selected: boolean };

// ---- Search: numbers match in Arabic, full-width and Chinese forms ----

const digits = '零一二三四五六七八九';
const smallUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const units = [['億', 1e8], ['萬', 1e4], ['千', 1000], ['百', 100], ['十', 10]] as const;
const numberCharacters = '0-9０-９零〇一二兩三四五六七八九十百千萬億';
const numberTokens = new RegExp(`([${numberCharacters}]+)`, 'u');
const escapeLiteral = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const digitWidths = (text: string) => text.replace(/[0-9]/gu, digit =>
  `[${digit}${String.fromCharCode(digit.charCodeAt(0) + 0xfee0)}]`);

/** Spell a whole quantity in Taiwanese Mandarin (including zeros between place values). */
function spellQuantity(value: number): string {
  for (const [unit, size] of units) {
    if (value < size) continue;
    const remainder = value % size;
    const gap = remainder && remainder < size / 10 ? '零' : '';
    return spellQuantity(Math.floor(value / size)) + unit + (remainder ? gap + spellQuantity(remainder) : '');
  }
  return digits[value];
}

function chineseValue(text: string): number | undefined {
  let total = 0, group = 0, digit = 0;
  for (const char of text) {
    if (char === '億' || char === '萬') {
      total += (group + digit) * (char === '億' ? 1e8 : 1e4);
      group = digit = 0;
    } else if (char in smallUnits) {
      group += (digit || 1) * smallUnits[char];
      digit = 0;
    } else {
      digit = digits.indexOf(char);
    }
  }
  const value = total + group + digit;
  // Colloquial sequences such as 一兩 or 三四 are not an exact quantity.
  const spelled = spellQuantity(value);
  return spelled === text || spelled.replace(/^一十/u, '十') === text ? value : undefined;
}

function quantityPattern(token: string) {
  if (token !== '兩' && /兩(?![百千萬億])/u.test(token)) return digitWidths(token.normalize('NFKC'));
  const normalized = token.normalize('NFKC').replaceAll('兩', '二').replaceAll('〇', '零');
  const arabic = /^[0-9]+$/u.test(normalized);
  const shorthand = normalized.match(/^([1-9][0-9]*)([十百千萬億])$/u);
  if (!arabic && !shorthand && /[0-9]/u.test(normalized)) return digitWidths(token.normalize('NFKC'));
  const multiplier = units.find(([unit]) => unit === shorthand?.[2]);
  const value = shorthand && multiplier ? Number(shorthand[1]) * multiplier[1]
    : arabic ? Number(normalized) : chineseValue(normalized);
  if (value === undefined) return token;
  if (shorthand && !Number.isSafeInteger(value)) return digitWidths(normalized);
  const decimal = arabic ? normalized : String(value);
  const forms = [digitWidths(decimal)];
  if (decimal === String(value) && value < 1e12) {
    const chinese = spellQuantity(value).replace(/^一十/u, '一?十').replaceAll('零', '[零〇]')
      .replace(/二(?=[百千萬億])|^二$/gu, '[二兩]');
    forms.push(chinese);
    if (value > 0) {
      for (const [unit, size] of units) {
        if (value % size === 0) forms.push(digitWidths(String(value / size)) + unit);
      }
    }
  } else if (shorthand) {
    forms.push(digitWidths(normalized));
  }
  // A search for 三元 must not match the last digit of 13元 or 十三元.
  return `(?<![${numberCharacters}])(?:${forms.join('|')})(?![${numberCharacters}])`;
}

/** Non-numeric text stays literal. Chinese units can sit next to a quantity or follow a space. */
export function ruleSearchSource(query: string) {
  const parts = query.split(numberTokens);
  return parts.map((part, index) => {
    if (index % 2) return quantityPattern(part);
    const spaceBefore = index > 0 && /^[ \t　]*\p{Script=Han}/u.test(part);
    const spaceAfter = index < parts.length - 1 && /\p{Script=Han}[ \t　]*$/u.test(part);
    const literal = escapeLiteral(part);
    const start = spaceBefore ? '[ \\t　]*' + literal.trimStart() : literal;
    return spaceAfter ? start.trimEnd() + '[ \\t　]*' : start;
  }).join('');
}

// ---- Player counts and editions ----

export const normalizePlayerCounts = (counts: number[]): number[] => Array.from(new Set(counts
  .filter((count) => Number.isInteger(count) && count >= 1 && count <= 8)))
  .sort((left, right) => left - right);

export const formatPlayerCounts = (counts: number[]): string => {
  const ranges: Array<[number, number]> = [];
  for (const count of normalizePlayerCounts(counts)) {
    const current = ranges[ranges.length - 1];
    if (current && count === current[1] + 1) current[1] = count;
    else ranges.push([count, count]);
  }
  return ranges.map(([start, end]) => start === end ? `${start}人` : `${start}~${end}人`).join('、');
};

export const getRuleEditions = (rule: Pick<FilterableRule, 'editionNotes' | 'editionNote'>): string[] => {
  const names = rule.editionNotes?.length ? rule.editionNotes : [rule.editionNote ?? ''];
  return names.map((rawName) => rawName.normalize('NFKC').trim()).filter(Boolean);
};

/** Return the literal to mark on each matching card, including phrases spanning adjacent fields. */
export const createRuleSearch = (query: string) => {
  const text = query.trim();
  if (!text) return undefined;
  const literal = new RegExp(`(${ruleSearchSource(text)})`, 'iu');
  const words = text.split(/ +/u);
  const acrossFields = words.length > 1 ? new RegExp(`(${words.map(ruleSearchSource).join('|')})`, 'iu') : undefined;
  return (rule: FilterableRule) => {
    const counts = rule.playerCounts ?? [];
    const fields = [rule.statement, rule.commonMistake, rule.details, ...counts.map(count => `${count}人`),
      ...getRuleEditions(rule), ...rule.tags.map(tag => tag.name)];
    if (fields.some(field => field && literal.test(field)) || literal.test(formatPlayerCounts(counts))) return literal;
    return acrossFields && literal.test(fields.join(' ')) ? acrossFields : undefined;
  };
};

// ---- Categories: a rule's own categories, otherwise hints from its tags and keyword tags ----

const normalizedText = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

export const detectAutomaticRuleCategories = (rule: FilterableRule, publicTags: FilterableTag[]): RuleCategory[] => {
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

export const effectiveRuleCategories = (rule: FilterableRule, publicTags: FilterableTag[]): RuleCategory[] =>
  rule.categories?.length ? rule.categories : detectAutomaticRuleCategories(rule, publicTags);

export const filterRulesByCategory = <T extends FilterableRule>(
  rules: T[],
  category: RuleCategoryFilter,
  publicTags: FilterableTag[] = [],
): T[] => category === 'all'
  ? rules
  : rules.filter((rule) => effectiveRuleCategories(rule, publicTags).includes(category));

// ---- The whole filter ----

const tagCollator = new Intl.Collator('zh-Hant');

/** Orders the tag row: selected tags first in the order chosen, then by how many visible rules carry each tag. */
export const orderTagOptions = (visibleRules: FilterableRule[], activeTags: string[], query: string): TagOption[] => {
  const pattern = query ? new RegExp(ruleSearchSource(query), 'iu') : undefined;
  const counts = new Map<string, number>();
  visibleRules.forEach((rule) => new Set(rule.tags.map((tag) => tag.name)).forEach((name) => {
    if (!activeTags.includes(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }));
  const others = Array.from(counts, ([name, count]) => ({ name, count, selected: false }))
    .filter((option) => !pattern || pattern.test(option.name))
    .sort((left, right) => right.count - left.count || tagCollator.compare(left.name, right.name));
  return [...activeTags.map((name) => ({ name, count: visibleRules.length, selected: true })), ...others];
};

/**
 * Applies a filter view and search to one game's rules. `rules` is the game's full list; `publicTags`
 * is the public tag catalog, whose keyword tags classify rules without categories of their own.
 * `filteredRules` keeps the input order. The other lists say which choices still lead somewhere.
 */
export const computeRuleFilter = <T extends FilterableRule>(
  rules: T[],
  publicTags: FilterableTag[],
  view: RuleFilterView,
  query: string,
) => {
  const { tags: activeTags, playerCounts: activePlayerCounts, editions: activeEditions } = view;
  const gameCategories = new Set(rules.flatMap((rule) => effectiveRuleCategories(rule, publicTags)));
  const selectedCategory: RuleCategoryFilter = view.category !== 'all' && gameCategories.has(view.category) ? view.category : 'all';

  const searchRule = createRuleSearch(query);
  let matches: Map<T, RegExp> | undefined;
  if (searchRule) {
    matches = new Map();
    for (const rule of rules) {
      const pattern = searchRule(rule);
      if (pattern) matches.set(rule, pattern);
    }
  }
  const rulesByQuery = matches ? [...matches.keys()] : rules;

  const matchesSpecial = (rule: T) => {
    if (activePlayerCounts.length && !rule.playerCounts?.some(count => activePlayerCounts.includes(count))) return false;
    if (activeEditions.length > 0) {
      const editions = getRuleEditions(rule);
      if (!activeEditions.some((e) => editions.includes(e))) return false;
    }
    return true;
  };
  const matchesTags = (rule: T) => activeTags.every((tagName) => rule.tags.some((tag) => tag.name === tagName));

  // Only offer an index that leads to rules under the other filters; keep the selected one so it can be cleared.
  const reachable = new Set(rulesByQuery
    .filter((rule) => matchesSpecial(rule) && matchesTags(rule))
    .flatMap((rule) => effectiveRuleCategories(rule, publicTags)));
  const availableCategories = RULE_CATEGORIES.filter((category) => category === selectedCategory || reachable.has(category));

  const rulesByCategory = filterRulesByCategory(rulesByQuery, selectedCategory, publicTags);
  const filteredRules = rulesByCategory.filter(matchesSpecial).filter(matchesTags);

  const allCounts = new Set<number>();
  const validCounts = new Set<number>();
  rules.forEach((r) => r.playerCounts?.forEach((c) => allCounts.add(c)));
  rulesByCategory.forEach((r) => r.playerCounts?.forEach((c) => validCounts.add(c)));
  const availablePlayerCounts = Array.from(allCounts).sort((a, b) => a - b)
    .filter((c) => activePlayerCounts.includes(c) || validCounts.has(c));

  const allEditions = new Set<string>();
  const validEditions = new Set<string>();
  rules.forEach((rule) => getRuleEditions(rule).forEach((edition) => allEditions.add(edition)));
  rulesByCategory.forEach((rule) => getRuleEditions(rule).forEach((edition) => validEditions.add(edition)));
  const availableEditions = Array.from(allEditions).sort().filter((e) => activeEditions.includes(e) || validEditions.has(e));

  return {
    selectedCategory,
    availableCategories,
    availablePlayerCounts,
    availableEditions,
    matches,
    filteredRules,
    tagOptions: orderTagOptions(filteredRules, activeTags, query.trim().toLocaleLowerCase()),
    // The search box alone is not a filter to clear; it has its own field.
    hasActiveFilters: activeTags.length > 0 || activePlayerCounts.length > 0 || activeEditions.length > 0,
  };
};
