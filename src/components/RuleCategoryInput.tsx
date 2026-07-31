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
  const toggle = (category: RuleCategory) => {
    onChange(
      selected.has(category)
        ? value.filter((item) => item !== category)
        : [...value, category]
    );
  };
  return <fieldset className="rule-category-input" disabled={disabled}>
    <legend>{label}</legend>
    <div className="rule-category-track">
      {RULE_CATEGORIES.map((category) => {
        const isSelected = selected.has(category);
        return <button
          type="button"
          key={category}
          disabled={disabled}
          className={isSelected ? 'category-btn selected' : 'category-btn'}
          aria-pressed={isSelected}
          onClick={() => toggle(category)}
        >
          {RULE_CATEGORY_LABELS[category]}
        </button>;
      })}
    </div>
  </fieldset>;
};
