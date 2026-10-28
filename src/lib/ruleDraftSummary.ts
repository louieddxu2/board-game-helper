import type { DraftRecord } from './localDb';

type DraftContent = Pick<DraftRecord, 'game' | 'gameQuery' | 'rules'>;
export const hasRuleDraftContent = (draft: DraftContent) => draft.rules.some(rule =>
  [rule.statement, rule.commonMistake, rule.details, rule.sourceLabel, rule.sourceUrl].some(value => value?.trim())
  || rule.tagSelections?.length || rule.tagNames?.length || rule.categories?.length || rule.playerCounts?.length || rule.editionNotes?.length);

export const ruleDraftSummary = (draft: DraftContent) => {
  const rules = draft.rules.map(rule => rule.statement.trim() || rule.commonMistake?.trim() || rule.details?.trim() || '尚未填寫規則內文').filter((_, index) => {
    const rule = draft.rules[index];
    return hasRuleDraftContent({ ...draft, rules: [rule] });
  });
  const excerpt = (value: string) => Array.from(value.replace(/\s+/gu, ' ')).slice(0, 80).join('') + (Array.from(value).length > 80 ? '…' : '');
  return [`「${draft.game?.displayName || draft.gameQuery || '尚未命名的遊戲'}」・${rules.length} 條草稿`,
    ...rules.slice(0, 2).map(rule => `「${excerpt(rule)}」`),
    ...(rules.length > 2 ? [`另有 ${rules.length - 2} 條規則。`] : []),
  ].join('\n');
};
