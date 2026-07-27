import { useCallback, useState } from 'react';
import { findEditionOption } from '../lib/editionOptions';
import { TextInputDialog } from './TextInputDialog';

interface EditionInputProps {
  value: string;
  options: string[];
  onChange(value: string): void;
}

export const EditionInput = ({ value, options, onChange }: EditionInputProps) => {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const selected = findEditionOption(options, value) ?? value.trim();

  const close = useCallback(() => { setAdding(false); setNewName(''); }, []);
  const add = () => {
    const name = newName.normalize('NFKC').trim();
    if (!name) return;
    onChange(findEditionOption(options, name) ?? name);
    close();
  };

  return <section className="edition-input">
    <header className="edition-input-heading">
      <span>版本／擴充</span>
      <button type="button" className="text-action" onClick={() => setAdding(true)}>＋新增版本／擴充</button>
    </header>
    {options.length > 0 && <div className="edition-options">
      {options.map((option) => {
        const active = option === selected;
        return <button type="button" key={option} className={`edition-option${active ? ' active' : ''}`}
          aria-pressed={active} onClick={() => onChange(active ? '' : option)}>{option}</button>;
      })}
    </div>}
    <TextInputDialog open={adding} title="新增版本／擴充" label="版本／擴充名稱" value={newName}
      confirmLabel="新增" maxLength={300} onChange={setNewName} onSubmit={add} onCancel={close} />
  </section>;
};
