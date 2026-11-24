import type { GameVariantSummary, RuleCategory } from '../shared/types';
import { EditionInput } from './EditionInput';
import { PlayerCountInput } from './PlayerCountInput';
import { RuleCategoryInput } from './RuleCategoryInput';

export interface UncertainRuleDraft {
  question: string;
  tableRuling: string;
  details: string;
  categories: RuleCategory[];
  playerCounts: number[];
  editionNotes: string[];
}

export const EMPTY_UNCERTAIN_RULE_DRAFT: UncertainRuleDraft = { question: '', tableRuling: '', details: '', categories: [], playerCounts: [], editionNotes: [] };

/** The trimmed request body for a draft; empty lists are sent so an edit can clear them. */
export const uncertainRuleInput = (draft: UncertainRuleDraft) => ({
  question: draft.question.trim(),
  tableRuling: draft.tableRuling.trim(),
  details: draft.details.trim(),
  categories: draft.categories,
  playerCounts: draft.playerCounts,
  editionNotes: draft.editionNotes,
});

/** An uncertain rule's fields, laid out like a recorded rule's so the two pages read alike. */
export const UncertainRuleFields = ({ value, onChange, editionOptions, variants, autoFocus = false }: {
  value: UncertainRuleDraft;
  onChange(value: UncertainRuleDraft): void;
  editionOptions: string[];
  variants?: GameVariantSummary[];
  autoFocus?: boolean;
}) => {
  const set = (patch: Partial<UncertainRuleDraft>) => onChange({ ...value, ...patch });
  return <div className="rule-input-fields uncertain-rule-fields">
    <label>不確定的問題 *<textarea autoFocus={autoFocus} rows={3} maxLength={2000} value={value.question} onChange={(event) => set({ question: event.target.value })} placeholder="例如：急速運輸能不能啟動同一張牌兩次？" /></label>
    <label>我們這桌先這樣玩<textarea rows={2} maxLength={2000} value={value.tableRuling} onChange={(event) => set({ tableRuling: event.target.value })} /></label>
    <label>補充說明<textarea rows={2} maxLength={5000} value={value.details} onChange={(event) => set({ details: event.target.value })} /></label>
    <RuleCategoryInput value={value.categories} onChange={(categories) => set({ categories })} />
    <PlayerCountInput value={value.playerCounts} onChange={(playerCounts) => set({ playerCounts })} />
    <EditionInput value={value.editionNotes} options={editionOptions} variants={variants} onChange={(editionNotes) => set({ editionNotes })} />
  </div>;
};
