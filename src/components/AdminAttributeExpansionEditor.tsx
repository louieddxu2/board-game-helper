import { useEffect, useState } from 'react';
import type { AttributeExpansionMetadata } from '../shared/types';

interface AdminAttributeExpansionEditorProps {
  expansion: AttributeExpansionMetadata;
  saving?: boolean;
  onSave(input: { englishName: string | null; aliases: string[] }): Promise<void>;
}

const splitAliases = (value: string) => value
  .split(/[,\n]/u)
  .map((item) => item.trim())
  .filter(Boolean);

export const AdminAttributeExpansionEditor = ({ expansion, saving = false, onSave }: AdminAttributeExpansionEditorProps) => {
  const [englishName, setEnglishName] = useState(expansion.englishName ?? '');
  const [aliases, setAliases] = useState(expansion.aliases.join('\n'));

  useEffect(() => {
    setEnglishName(expansion.englishName ?? '');
    setAliases(expansion.aliases.join('\n'));
  }, [expansion]);

  return <form
    className="admin-attribute-expansion-editor"
    onSubmit={(event) => {
      event.preventDefault();
      void onSave({ englishName: englishName.trim() || null, aliases: splitAliases(aliases) });
    }}
  >
    <div className="admin-attribute-expansion-heading">
      <div>
        <strong>{expansion.displayName}</strong>
        <small>{expansion.baseGameName}＋{expansion.expansionName}{expansion.bggId ? `・BGG ${expansion.bggId}` : ''}</small>
      </div>
      <span className="admin-attribute-expansion-label">擴充</span>
    </div>
    <label>英文名稱<input value={englishName} onChange={(event) => setEnglishName(event.target.value)} placeholder="例如：The Ketchup Mechanism & Other Ideas" /></label>
    <label>可搜尋的別名（每行一個）<textarea rows={3} value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="例如：Ketchup Mechanism" /></label>
    <button type="submit" className="button secondary" disabled={saving}>{saving ? '儲存中…' : '儲存擴充資料'}</button>
  </form>;
};
