import { RULE_CATEGORIES, RULE_CATEGORY_LABELS, type RuleCategory } from '../shared/types';

interface RuleCategoryInputProps {
  value: RuleCategory[];
  onChange(value: RuleCategory[]): void;
  disabled?: boolean;
  label?: string;
}

export const RuleCategoryInput = ({
  value,
  onChange,
  disabled = false,
  label = '規則分類',
}: RuleCategoryInputProps) => {
  const selected = new Set(value);
  return <fieldset className="rule-category-input" disabled={disabled}>
    <legend>{label}</legend>
    <div className="rule-category-options">
      {RULE_CATEGORIES.map((category) => <label key={category}>
        <input
          type="checkbox"
          checked={selected.has(category)}
          onChange={(event) => onChange(event.target.checked
            ? [...value, category]
            : value.filter((item) => item !== category))}
        />
        <span>{RULE_CATEGORY_LABELS[category]}</span>
      </label>)}
    </div>
  </fieldset>;
};
