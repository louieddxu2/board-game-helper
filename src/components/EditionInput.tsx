import { useCallback, useState } from 'react';
import type { GameEntityKind } from '../shared/gameEntity';
import type { GameVariantSummary } from '../shared/types';
import { classifyGameEntityLabel } from '../shared/gameEntity';
import { findEditionOption, mergeEditionOptions } from '../lib/editionOptions';
import { TextInputDialog } from './TextInputDialog';

interface EditionInputProps {
  value: string[];
  options: string[];
  variants?: GameVariantSummary[];
  onChange(value: string[]): void;
  disabled?: boolean;
}

const kindLabel = (kind: GameEntityKind) => kind === 'expansion' ? '擴充' : kind === 'version' ? '版本' : kind === 'base' ? '主遊戲' : '待分類';

export const EditionInput = ({ value, options, variants = [], onChange, disabled = false }: EditionInputProps) => {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const selected = mergeEditionOptions(value);
  const visibleOptions = mergeEditionOptions(options, variants.map((variant) => variant.displayName), selected);
  const variantFor = (option: string) => variants.find((variant) => findEditionOption([variant.displayName], option));

  const close = useCallback(() => { setAdding(false); setNewName(''); }, []);
  const add = () => {
    const name = newName.normalize('NFKC').trim();
    if (!name) return;
    const option = findEditionOption(visibleOptions, name) ?? name;
    if (!findEditionOption(selected, option)) onChange([...selected, option]);
    close();
  };

  return <section className="edition-input">
    <header className="edition-input-heading">
      <span>版本／擴充</span>
      <button type="button" className="text-action" disabled={disabled} onClick={() => setAdding(true)}>＋新增版本／擴充</button>
    </header>
    {visibleOptions.length > 0 && <div className="edition-options">
      {visibleOptions.map((option) => {
        const active = Boolean(findEditionOption(selected, option));
        const variant = variantFor(option);
        const kind = variant?.entityKind ?? classifyGameEntityLabel(option);
        return <button type="button" key={option} className={`edition-option${active ? ' active' : ''}`}
          disabled={disabled} title={`${option}（${kindLabel(kind)}）`}
          aria-pressed={active} onClick={() => onChange(active
            ? selected.filter((name) => name !== findEditionOption(selected, option))
            : [...selected, option])}><span>{option}</span><small aria-hidden="true">{kindLabel(kind)}</small></button>;
      })}
    </div>}
    <TextInputDialog open={adding} title="新增版本／擴充" label="版本／擴充名稱" value={newName}
      confirmLabel="新增" maxLength={300} onChange={setNewName} onSubmit={add} onCancel={close} />
  </section>;
};
