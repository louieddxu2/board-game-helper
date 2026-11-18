import { getRuleEditions } from './editionOptions';
import { formatPlayerCounts } from './playerCounts';
import type { RuleCard } from '../shared/types';
import { ruleSearchSource } from './ruleSearchNumbers';

export const searchPlayerLabel = (counts: number[], pattern?: RegExp) => {
  const range = formatPlayerCounts(counts);
  // A search for 3人 can match the middle of a displayed range such as 2~4人.
  if (!pattern || pattern.test(range)) return range;
  const labels = counts.map(count => `${count}人`);
  return labels.some(label => pattern.test(label)) ? labels.join('、') : range;
};

/** Return the literal to mark on each matching card, including phrases spanning adjacent fields. */
export const createRuleSearch = (query: string) => {
  const text = query.trim();
  if (!text) return undefined;
  const literal = new RegExp(`(${ruleSearchSource(text)})`, 'iu');
  const words = text.split(/ +/u);
  const acrossFields = words.length > 1 ? new RegExp(`(${words.map(ruleSearchSource).join('|')})`, 'iu') : undefined;
  return (rule: RuleCard) => {
    const counts = rule.playerCounts ?? [];
    const fields = [rule.statement, rule.commonMistake, rule.details, ...counts.map(count => `${count}人`),
      ...getRuleEditions(rule), ...rule.tags.map(tag => tag.name)];
    if (fields.some(field => field && literal.test(field)) || literal.test(formatPlayerCounts(counts))) return literal;
    return acrossFields && literal.test(fields.join(' ')) ? acrossFields : undefined;
  };
};
