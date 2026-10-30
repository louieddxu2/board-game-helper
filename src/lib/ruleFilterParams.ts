import { RULE_CATEGORIES, type RuleCategory } from '../shared/types';

export type RuleFilterView = {
  category: 'all' | RuleCategory;
  tags: string[];
  playerCounts: number[];
  editions: string[];
};

export type RuleFilterPatch = Partial<RuleFilterView & { query: string }>;

const unique = <T>(values: T[]) => Array.from(new Set(values));
const cleanText = (values: string[]) => unique(values.map((value) => value.trim()).filter(Boolean));

/** Game page filters live in the URL so copied, shared and reloaded links keep the same view. */
export const readRuleFilterParams = (params: URLSearchParams): RuleFilterView => {
  const category = params.get('category');
  return {
    category: RULE_CATEGORIES.includes(category as RuleCategory) ? category as RuleCategory : 'all',
    // `tags` is the older comma-joined form; `tag` repeats so each value stays intact.
    tags: cleanText([...params.getAll('tag'), ...params.getAll('tags').flatMap((value) => value.split(','))]),
    playerCounts: unique(params.getAll('players').map(Number).filter((count) => Number.isInteger(count) && count > 0)),
    editions: cleanText(params.getAll('edition')),
  };
};

export const writeRuleFilterParams = (current: URLSearchParams, patch: RuleFilterPatch) => {
  const next = new URLSearchParams(current);
  const replace = (key: string, values: Array<string | number>) => {
    next.delete(key);
    values.forEach((value) => next.append(key, String(value)));
  };
  if (patch.category !== undefined) replace('category', patch.category === 'all' ? [] : [patch.category]);
  if (patch.tags) {
    next.delete('tags');
    replace('tag', patch.tags);
  }
  if (patch.playerCounts) replace('players', patch.playerCounts);
  if (patch.editions) replace('edition', patch.editions);
  if (patch.query !== undefined) replace('find', patch.query ? [patch.query] : []);
  return next;
};
