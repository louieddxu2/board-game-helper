import { useMemo, useState } from 'react';
import { coerceCellValue, displayWorkspaceCellValue, formatMultiSelectValues, isWorkspaceLinkValue, parseMultiSelectValues, workspaceOptionColor } from './model';
import { WorkspaceCellValue, WorkspaceColumn, WorkspaceRow } from './types';
import { DateTimeWheelEditor } from './workspaceCellDialogs';
import type { WorkspaceModalOwner } from './workspaceModalClose';
import { AutoGrowTextarea, NameDialogState, WorkspaceIcon, WorkspaceModal } from './workspaceShared';

export const NameDialog = ({ state, onClose, onSubmit }: { state: NameDialogState; onClose(): void; onSubmit(name: string): void }) => {
  const [name, setName] = useState(state.initialValue);
  const label = state.mode === 'folder' ? '資料夾名稱' : state.mode === 'table' ? '表格名稱' : '名稱';
  const title = state.mode === 'folder' ? '新增資料夾' : state.mode === 'table' ? '新增表格' : '重新命名';
  const finish = () => { const value = name.trim(); if (value) onSubmit(value); else onClose(); };
  return <WorkspaceModal owner="name-editor" title={title} dialogKind="editor" onRequestClose={finish} className="workspace-name-dialog">
    <label className="workspace-form-field">{label}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finish(); } }} /></label>
  </WorkspaceModal>;
};

export const ConfirmDialog = ({ title, message, onClose, onConfirm }: { title: string; message: string; onClose(): void; onConfirm(): void }) => <WorkspaceModal owner="confirm" title={title} onRequestClose={onClose} className="workspace-confirm-dialog" actions={<><button type="button" className="workspace-dialog-button secondary" onClick={onClose}>取消</button><button type="button" className="workspace-dialog-button danger" onClick={onConfirm}>確認</button></>}><p className="workspace-dialog-message">{message}</p></WorkspaceModal>;

export const WorkspaceSelectionDialog = ({ owner = 'selection-editor', column, value, options, onClose, onSelect, onChange, onConfirm }: { owner?: WorkspaceModalOwner; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; onClose(): void; onSelect?(value: string): void; onChange?(value: string): void; onConfirm?(value: string): void }) => {
  const isMultiple = Boolean(column.isMultiple);
  const isDynamic = column.inputType === 'dynamic-select';
  const [query, setQuery] = useState('');
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set(isMultiple ? parseMultiSelectValues(value) : [value == null ? '' : String(value)]));

  const allOptions = useMemo(() => Array.from(new Set([...options, ...selectedSet].filter(Boolean))), [options, selectedSet]);
  const filtered = useMemo(() => {
    if (!isDynamic) return allOptions;
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? allOptions.filter((option) => option.toLocaleLowerCase().includes(normalized)) : allOptions;
  }, [allOptions, isDynamic, query]);

  const normalizedQuery = query.trim();

  const applyMultiple = (next: Set<string>) => {
    setSelectedSet(next);
    if (!onConfirm) onChange?.(formatMultiSelectValues(Array.from(next)));
  };

  const toggleOption = (option: string) => {
    if (!isMultiple) {
      if (onConfirm) setSelectedSet(new Set([option]));
      else onSelect?.(option);
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    applyMultiple(next);
  };

  const submitQuery = () => {
    if (!normalizedQuery) return;
    const existingOption = allOptions.find((option) => option.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());
    const optionToAdd = existingOption ?? normalizedQuery;
    if (isMultiple) {
      const next = new Set(selectedSet);
      next.add(optionToAdd);
      applyMultiple(next);
      setQuery('');
    } else {
      if (onConfirm) setSelectedSet(new Set([optionToAdd]));
      else onSelect?.(optionToAdd);
    }
  };

  const selectAll = () => applyMultiple(new Set(allOptions));
  const clearAll = () => applyMultiple(new Set());
  const clearSelection = () => {
    if (isMultiple) {
      applyMultiple(new Set());
      if (!onConfirm) onClose();
      return;
    }
    if (onConfirm) setSelectedSet(new Set());
    else onSelect?.('');
  };
  const hasSingleValue = !isMultiple && Array.from(selectedSet).some(Boolean);

  const confirmSelection = () => {
    let nextSelection = selectedSet;
    if (isDynamic && normalizedQuery) {
      const existingOption = allOptions.find((option) => option.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());
      const optionToAdd = existingOption ?? normalizedQuery;
      nextSelection = isMultiple ? new Set([...selectedSet, optionToAdd]) : new Set([optionToAdd]);
    }
    onConfirm?.(isMultiple ? formatMultiSelectValues(Array.from(nextSelection)) : Array.from(nextSelection)[0] ?? '');
  };
  const finish = () => {
    if (onConfirm) {
      onClose();
      return;
    }
    if (isDynamic && normalizedQuery) submitQuery();
    else onClose();
  };

  return <WorkspaceModal owner={owner} title={column.name} dialogKind="editor" onRequestClose={finish} className="workspace-selection-dialog" initialFocus={isDynamic ? 'close-button' : 'content'} actions={onConfirm ? <button type="button" className="workspace-dialog-button primary" onClick={confirmSelection}>確認</button> : undefined}>
    {isDynamic && <div className="workspace-selection-head">
      <label className="workspace-selection-search"><WorkspaceIcon name="search" size={19} /><span className="sr-only">搜尋或新增選項</span><input inputMode="text" enterKeyHint="done" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitQuery(); } }} placeholder="搜尋或輸入…" /><button type="button" onClick={() => setQuery('')} aria-label="清除搜尋" disabled={!query}><WorkspaceIcon name="close" size={17} /></button></label>
    </div>}
    <div className="workspace-selection-list" role="listbox" aria-label={`${column.name}選項`}>
      {filtered.map((option, index) => {
        const isSelected = selectedSet.has(option);
        return <button type="button" key={`${index}-${option}`} role="option" aria-selected={isSelected} className={`workspace-selection-option ${isSelected ? 'selected' : ''}`} onClick={() => toggleOption(option)}>
          {isMultiple && <span className="workspace-selection-option-indicator" aria-hidden="true" />}
          <span className="workspace-selection-option-label" style={{ color: workspaceOptionColor(column, option) }}>{option}</span>
        </button>;
      })}
      {!filtered.length && <p className="workspace-selection-empty">{isDynamic && normalizedQuery ? '按 Enter 新增這個選項' : '目前沒有可選項目'}</p>}
    </div>
    {(isMultiple || hasSingleValue) && <div className="workspace-selection-footer">
      <div className="workspace-selection-tools">
        {isMultiple && <button type="button" className="workspace-selection-tool" onClick={selectAll} aria-label="全選" title="全選">全選</button>}
        <button type="button" className="workspace-selection-tool is-clear" onClick={clearSelection} aria-label="清除" title="清除">清除</button>
      </div>
    </div>}
  </WorkspaceModal>;
};

export const ColumnVisibilityDialog = ({ columns, onClose, onToggle }: { columns: WorkspaceColumn[]; onClose(): void; onToggle(columnId: string): void }) => <WorkspaceModal owner="column-visibility" title="欄位顯示設定" dialogKind="editor" onRequestClose={onClose} className="workspace-column-visibility-dialog">
  <div className="workspace-column-visibility-list" role="group" aria-label="欄位顯示設定">
    {columns.map((column) => <div className={`workspace-column-visibility-row ${column.hidden ? 'is-hidden' : ''}`} key={column.id}>
      <span className="workspace-column-visibility-name">{column.name || '未命名屬性'}</span>
      <button type="button" className="workspace-icon-button workspace-visibility-toggle" aria-label={column.hidden ? `顯示 ${column.name || '未命名屬性'}` : `隱藏 ${column.name || '未命名屬性'}`} aria-pressed={!column.hidden} onClick={() => onToggle(column.id)}><WorkspaceIcon name={column.hidden ? 'eye-off' : 'eye'} size={22} /></button>
    </div>)}
    {!columns.length && <p className="workspace-column-visibility-empty">目前沒有可設定的欄位</p>}
  </div>
</WorkspaceModal>;

const HiddenFieldEditor = ({ column, value, options, onChange }: { column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; onChange(value: WorkspaceCellValue): void }) => {
  const [dynamicDraft, setDynamicDraft] = useState('');
  const listOptions = options.length ? options : column.options;
  const selectedValues = parseMultiSelectValues(value);
  const toggleOption = (option: string) => {
    if (!column.isMultiple) {
      onChange(option);
      return;
    }
    const next = new Set(selectedValues);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(formatMultiSelectValues([...next]));
  };
  const addDynamicValue = () => {
    const normalized = dynamicDraft.trim();
    if (!normalized) return;
    const existing = listOptions.find((option) => option.toLocaleLowerCase() === normalized.toLocaleLowerCase()) ?? normalized;
    if (column.isMultiple) onChange(formatMultiSelectValues([...new Set([...selectedValues, existing])]));
    else onChange(existing);
    setDynamicDraft('');
  };
  if (column.inputType === 'link') {
    const link = isWorkspaceLinkValue(value) ? value : { url: typeof value === 'string' ? value : '', label: '' };
    return <div className="workspace-hidden-link-fields">
      <label className="workspace-form-field">連結<input type="url" inputMode="url" value={link.url} onChange={(event) => onChange({ ...link, url: event.target.value })} /></label>
      <label className="workspace-form-field">顯示名稱<input type="text" inputMode="text" value={link.label} onChange={(event) => onChange({ ...link, label: event.target.value })} /></label>
    </div>;
  }
  if (column.inputType === 'datetime') return <DateTimeWheelEditor value={value} ariaLabel={`${column.name}${column.dateOnly ? '日期' : '日期時間'}`} showTime={!column.dateOnly} onChange={(next) => onChange(coerceCellValue(column, next))} onClear={() => onChange(null)} />;
  if (column.inputType === 'number') return <input className="workspace-hidden-field-input" type="number" inputMode="decimal" step="any" value={value == null ? '' : String(value)} onChange={(event) => onChange(coerceCellValue(column, event.target.value))} />;
  if (column.inputType === 'select' || column.inputType === 'dynamic-select') return <div className="workspace-hidden-select-editor">
    <div className="workspace-hidden-select-options" role="group" aria-label={`${column.name}選項`}>
      {listOptions.map((option) => <button type="button" key={option} className={selectedValues.includes(option) ? 'selected' : ''} onClick={() => toggleOption(option)}>{option}</button>)}
      {!listOptions.length && <span className="workspace-hidden-select-empty">尚無既有選項</span>}
    </div>
    {column.inputType === 'dynamic-select' && <div className="workspace-hidden-select-add"><input type="text" inputMode="text" value={dynamicDraft} placeholder="輸入新選項" onChange={(event) => setDynamicDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDynamicValue(); } }} /><button type="button" onClick={addDynamicValue} aria-label={`新增${column.name}選項`}><WorkspaceIcon name="plus" size={17} /></button></div>}
  </div>;
  return <AutoGrowTextarea className="workspace-hidden-field-input workspace-hidden-field-textarea" value={displayWorkspaceCellValue(value, column.inputType)} onChange={(event) => onChange(coerceCellValue(column, event.target.value))} />;
};

export const HiddenFieldsDialog = ({ title, row, columns, optionsByColumn, onSave }: { title: string; row: WorkspaceRow; columns: WorkspaceColumn[]; optionsByColumn: Record<string, string[]>; onSave(values: Record<string, WorkspaceCellValue>): void }) => {
  const [draft, setDraft] = useState<Record<string, WorkspaceCellValue>>(() => Object.fromEntries(columns.map((column) => [column.id, row.values[column.id] ?? null])));
  const updateValue = (columnId: string, value: WorkspaceCellValue) => setDraft((current) => ({ ...current, [columnId]: value }));
  return <WorkspaceModal owner="hidden-fields" title={title || '物件'} dialogKind="editor" onRequestClose={() => onSave(draft)} className="workspace-hidden-fields-dialog">
    <div className="workspace-hidden-fields-list">
      {columns.map((column) => <div className="workspace-hidden-field" key={column.id}>
        <span className="workspace-hidden-field-label">{column.name || '未命名屬性'}</span>
        <HiddenFieldEditor column={column} value={draft[column.id] ?? null} options={optionsByColumn[column.id] ?? []} onChange={(value) => updateValue(column.id, value)} />
      </div>)}
      {!columns.length && <p className="workspace-hidden-fields-empty">目前沒有隱藏欄位</p>}
    </div>
  </WorkspaceModal>;
};
