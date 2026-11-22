import { formatPlayerCounts } from './playerCounts';

export const searchPlayerLabel = (counts: number[], pattern?: RegExp) => {
  const range = formatPlayerCounts(counts);
  // A search for 3人 can match the middle of a displayed range such as 2~4人.
  if (!pattern || pattern.test(range)) return range;
  const labels = counts.map(count => `${count}人`);
  return labels.some(label => pattern.test(label)) ? labels.join('、') : range;
};

// Moved into the rule filter shared with the score pad app.
export { createRuleSearch } from '../shared/ruleFilter';
