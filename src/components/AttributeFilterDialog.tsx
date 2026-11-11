import { useId, useRef, useState } from 'react';
import type { AttributeDefinition } from '../shared/types';

interface AttributeFilterDialogProps {
  options: AttributeDefinition[] | undefined;
  filter: ReadonlySet<string> | null;
  disabled: boolean;
  loadOptions: () => Promise<unknown>;
  onApply: (filter: ReadonlySet<string> | null) => void;
}

export const AttributeFilterDialog = ({ options, filter, disabled, loadOptions, onApply }: AttributeFilterDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<ReadonlySet<string> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const orderedOptions = [...(options ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
  const selectedIds = orderedOptions.filter(({ id }) => !draft || draft.has(id)).map(({ id }) => id);
  const allSelected = orderedOptions.length > 0 && selectedIds.length === orderedOptions.length;

  const load = () => {
    setLoadFailed(false);
    void loadOptions().catch(() => setLoadFailed(true));
  };
  const open = () => {
    if (disabled) return;
    setDraft(filter);
    dialogRef.current?.showModal();
    if (!options) load();
  };
  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setDraft(next);
  };
  const apply = () => {
    dialogRef.current?.close();
    const nextFilter = allSelected ? null : new Set(selectedIds);
    if (nextFilter === null && filter === null) return;
    if (nextFilter && filter?.size === nextFilter.size && selectedIds.every((id) => filter.has(id))) return;
    onApply(nextFilter);
  };

  return <>
    <button type="button" className={`attributes-filter-trigger${filter ? ' is-filtered' : ''}`} aria-haspopup="dialog" onClick={open} aria-disabled={disabled}>
      抽選屬性{filter && <span className="attributes-filter-count">{filter.size}</span>}
    </button>
    <dialog ref={dialogRef} className="attributes-filter-dialog" aria-labelledby={titleId}>
      <div className="attributes-filter-heading">
        <h2 id={titleId}>抽選屬性</h2>
        <button type="button" className="attributes-filter-close" aria-label="關閉" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <div className="attributes-filter-list" role="group" aria-label="可抽選的屬性">
        {orderedOptions.map((attribute) => {
          const description = attribute.fullDescription || attribute.shortDescription;
          const descriptionId = `${titleId}-${attribute.id}`;
          const nameId = `${descriptionId}-name`;
          return <label className="attributes-filter-option" key={attribute.id}>
            <input type="checkbox" checked={!draft || draft.has(attribute.id)} aria-labelledby={nameId} aria-describedby={description ? descriptionId : undefined}
              onChange={(event) => toggle(attribute.id, event.target.checked)} />
            <span>
              <strong id={nameId}>{attribute.name}</strong>
              {description && <span id={descriptionId} className="attributes-filter-description">{description}</span>}
            </span>
          </label>;
        })}
        {!options && (loadFailed
          ? <p className="attributes-filter-status">目前無法載入屬性。<button type="button" onClick={load}>重試</button></p>
          : <p className="attributes-filter-status" role="status">載入屬性中…</p>)}
        {options?.length === 0 && <p className="attributes-filter-status">目前沒有可抽選的屬性。</p>}
      </div>
      <div className="attributes-filter-footer">
        <button type="button" onClick={() => setDraft(null)} disabled={!orderedOptions.length || allSelected}>全選</button>
        <button type="button" onClick={() => setDraft(new Set())} disabled={!selectedIds.length}>清除</button>
        <span className="attributes-filter-summary" aria-live="polite">{options && `已選 ${selectedIds.length}／${options.length}`}</span>
        <button type="button" className="attributes-filter-apply" onClick={apply} disabled={disabled || !selectedIds.length}>套用</button>
      </div>
    </dialog>
  </>;
};
