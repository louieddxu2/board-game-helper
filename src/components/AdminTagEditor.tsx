import { useEffect, useState } from 'react';
import { RULE_CATEGORY_LABELS, type RuleCategory, type TagSummary } from '../shared/types';
import { RuleCategoryInput } from './RuleCategoryInput';

interface AdminTagEditorProps {
  tag: TagSummary;
  onSave(input: { name: string; aliases: string[]; categoryHints: RuleCategory[] }): Promise<void>;
  onTogglePublic(tag: TagSummary): Promise<void> | void;
}

const parseAliases = (value: string): string[] => Array.from(new Set(value
  .split(/[,，\n]/)
  .map((alias) => alias.trim())
  .filter(Boolean)));

export const AdminTagEditor = ({ tag, onSave, onTogglePublic }: AdminTagEditorProps) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(tag.name);
  const [aliases, setAliases] = useState((tag.aliases ?? []).join(', '));
  const [categoryHints, setCategoryHints] = useState<RuleCategory[]>(tag.categoryHints ?? []);

  useEffect(() => {
    if (editing) return;
    setName(tag.name);
    setAliases((tag.aliases ?? []).join(', '));
    setCategoryHints(tag.categoryHints ?? []);
  }, [editing, tag]);

  if (editing) {
    return <form
      className="admin-tag-editor"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName || saving) return;
        setSaving(true);
        void onSave({ name: trimmedName, aliases: parseAliases(aliases), categoryHints })
          .then(() => setEditing(false))
          .finally(() => setSaving(false));
      }}
    >
      <label>Tag 名稱<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required /></label>
      <label>別名<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="以逗號分隔" /></label>
      <RuleCategoryInput value={categoryHints} onChange={setCategoryHints} label="自動分類提示" />
      <div className="inline-actions">
        <button type="submit" className="button primary" disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
        <button type="button" className="button secondary" disabled={saving} onClick={() => setEditing(false)}>取消</button>
      </div>
    </form>;
  }

  return <div className="admin-tag-row">
    <div>
      <strong>#{tag.name}</strong>
      {tag.isPublic
        ? <span className="tag-chip active" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>公共</span>
        : <span className="tag-chip" style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}>專屬</span>}
      <small style={{ display: 'block' }}>使用數: {tag.usageCount ?? 0} 條 {tag.description && `・${tag.description}`}</small>
      {Boolean(tag.aliases?.length) && <small style={{ display: 'block' }}>別名：{tag.aliases!.join('、')}</small>}
      {Boolean(tag.categoryHints?.length) && <small style={{ display: 'block' }}>分類提示：{tag.categoryHints!.map((category) => RULE_CATEGORY_LABELS[category]).join('、')}</small>}
    </div>
    <div className="inline-actions">
      <button type="button" className="text-action" onClick={() => setEditing(true)}>編輯</button>
      <button type="button" className="text-action" onClick={() => void onTogglePublic(tag)}>
        {tag.isPublic ? '設為專屬' : '設為公共'}
      </button>
    </div>
  </div>;
};
