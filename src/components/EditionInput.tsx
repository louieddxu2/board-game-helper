import { useCallback, useState } from 'react';
import { findEditionOption, mergeEditionOptions } from '../lib/editionOptions';
import { TextInputDialog } from './TextInputDialog';

interface EditionInputProps {
  value: string[];
  options: string[];
  onChange(value: string[]): void;
}

export const EditionInput = ({ value, options, onChange }: EditionInputProps) => {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const selected = mergeEditionOptions(value);
  const visibleOptions = mergeEditionOptions(options, selected);

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
      <button type="button" className="text-action" onClick={() => setAdding(true)}>＋新增版本／擴充</button>
    </header>
    {visibleOptions.length > 0 && <div className="edition-options">
      {visibleOptions.map((option) => {
        const active = Boolean(findEditionOption(selected, option));
        return <button type="button" key={option} className={`edition-option${active ? ' active' : ''}`}
          aria-pressed={active} onClick={() => onChange(active
            ? selected.filter((name) => name !== findEditionOption(selected, option))
            : [...selected, option])}>{option}</button>;
      })}
    </div>}
    <TextInputDialog open={adding} title="新增版本／擴充" label="版本／擴充名稱" value={newName}
      confirmLabel="新增" maxLength={300} onChange={setNewName} onSubmit={add} onCancel={close} />
  </section>;
};
