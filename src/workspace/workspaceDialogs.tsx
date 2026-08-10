import { useEffect, useMemo, useRef, useState } from "react";
import { displayWorkspaceCellValue, formatMultiSelectValues, isWorkspaceLinkValue, parseMultiSelectValues } from "./model";
import { WorkspaceCellValue, WorkspaceColumn, WorkspaceInputType, WorkspaceLinkValue, WorkspaceOverflowMode, WorkspaceTextAlign } from "./types";
import { AutoGrowTextarea, dateTimeLocalValue, defaultInputTypeFor, HeaderFilterAggregate, HeaderFilterOption, HeaderFilterState, inputCategoryFor, inputCategoryLabels, inputSubtypeLabels, NameDialogState, overflowModeLabels, WorkspaceIcon, WorkspaceInputCategory, WorkspaceModal } from "./workspaceShared";

export const CellInputDialog = ({ column, value, inputLabel, onDelete, onSave }: CellInputDialogProps) => {
  const [draft, setDraft] = useState(column.inputType === 'datetime' ? dateTimeLocalValue(value) : displayWorkspaceCellValue(value, column.inputType));
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    if (input instanceof HTMLInputElement) input.select();
    else input?.setSelectionRange(0, input.value.length);
  }, []);

  const commit = () => onSave(draft);
  return <WorkspaceModal title={column.name} onClose={commit} className="workspace-value-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
    {column.inputType === 'datetime'
      ? <input ref={inputRef as React.RefObject<HTMLInputElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input" type="datetime-local" value={draft} onChange={(event) => setDraft(event.target.value)} />
      : column.inputType === 'number'
      ? <input ref={inputRef as React.RefObject<HTMLInputElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input" type="number" inputMode="decimal" enterKeyHint="done" step="any" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
      : <AutoGrowTextarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input workspace-value-textarea" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); } }} />}
  </WorkspaceModal>;
};
export const LinkInputDialog = ({ column, value, onDelete, onSave }: { column: WorkspaceColumn; value: WorkspaceCellValue; onDelete?(): void; onSave(value: WorkspaceLinkValue | null): void }) => {
  const initial = isWorkspaceLinkValue(value) ? value : { url: typeof value === 'string' ? value : '', label: '' };
  const [url, setUrl] = useState(initial.url);
  const [label, setLabel] = useState(initial.label);
  const commit = () => onSave(url.trim() || label.trim() ? { url: url.trim(), label: label.trim() } : null);
  return <WorkspaceModal title={column.name} onClose={commit} className="workspace-link-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
    <div className="workspace-link-fields">
      <label className="workspace-form-field">連結<input autoFocus type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <label className="workspace-form-field">顯示名稱<input type="text" inputMode="text" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
    </div>
  </WorkspaceModal>;
};
export const HeaderFilterDialog = ({ label, inputType, options, numericValues, state, onClose, onSort, onToggle, onSelectAll, onClearAll, onQuery, onRange, onAggregate }: { label: string; inputType?: WorkspaceInputType; options: HeaderFilterOption[]; numericValues: number[]; state: HeaderFilterState; onClose(): void; onSort(direction: 'asc' | 'desc'): void; onToggle(key: string): void; onSelectAll(): void; onClearAll(): void; onQuery(query: string): void; onRange(min: string, max: string): void; onAggregate(aggregate: HeaderFilterAggregate): void }) => {
  const [optionQuery, setOptionQuery] = useState('');
  const visibleOptions = useMemo(() => {
    const normalized = optionQuery.trim().toLocaleLowerCase();
    return normalized ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalized)) : options;
  }, [options, optionQuery]);
  const selected = state.includedKeys === null ? null : new Set(state.includedKeys);
  const isText = inputType === 'text';
  const isNumber = inputType === 'number';
  const aggregate = state.aggregate ?? 'sum';
  const aggregateValue = numericValues.length
    ? aggregate === 'sum' ? numericValues.reduce((total, value) => total + value, 0) : numericValues.reduce((total, value) => total + value, 0) / numericValues.length
    : undefined;
  return <WorkspaceModal title={`篩選 ${label}`} onClose={onClose} className="workspace-filter-dialog">
    <div className="workspace-filter-sort" role="group" aria-label={`排序 ${label}`}>
      <button type="button" className={state.sort === 'asc' ? 'selected' : ''} onClick={() => onSort('asc')}><WorkspaceIcon name="up" size={18} />升冪</button>
      <button type="button" className={state.sort === 'desc' ? 'selected' : ''} onClick={() => onSort('desc')}><WorkspaceIcon name="down" size={18} />降冪</button>
    </div>
    {isText && <label className="workspace-filter-search"><WorkspaceIcon name="search" size={19} /><span className="sr-only">搜尋{label}的值</span><input type="search" aria-label={`搜尋${label}的值`} value={state.query ?? ''} onChange={(event) => onQuery(event.target.value)} /></label>}
    {isNumber && <>
      <div className="workspace-filter-range" role="group" aria-label={`${label}範圍`}>
        <label>最小值<input type="number" inputMode="decimal" aria-label={`${label}最小值`} value={state.min ?? ''} onChange={(event) => onRange(event.target.value, state.max ?? '')} /></label>
        <span aria-hidden="true">至</span>
        <label>最大值<input type="number" inputMode="decimal" aria-label={`${label}最大值`} value={state.max ?? ''} onChange={(event) => onRange(state.min ?? '', event.target.value)} /></label>
      </div>
      <div className="workspace-filter-aggregate" role="group" aria-label={`${label}統計`}>
        <button type="button" className={aggregate === 'sum' ? 'selected' : ''} onClick={() => onAggregate('sum')}>總和</button>
        <button type="button" className={aggregate === 'average' ? 'selected' : ''} onClick={() => onAggregate('average')}>平均</button>
        <output aria-label={`${label}${aggregate === 'sum' ? '總和' : '平均'}`}>{aggregateValue === undefined ? '—' : aggregateValue.toLocaleString('zh-Hant-TW', { maximumFractionDigits: 4 })}</output>
      </div>
      <p className="workspace-filter-result-count">目前符合 {numericValues.length} 筆</p>
    </>}
    {!isText && !isNumber && <>
      <label className="workspace-filter-search"><WorkspaceIcon name="search" size={19} /><span className="sr-only">搜尋{label}的值</span><input type="search" aria-label={`搜尋${label}的值`} value={optionQuery} onChange={(event) => setOptionQuery(event.target.value)} /></label>
      <div className="workspace-filter-selection-actions"><button type="button" onClick={onSelectAll}>全部</button><button type="button" onClick={onClearAll}>清除</button></div>
      <div className="workspace-filter-options" role="group" aria-label={`${label}篩選值`}>
        {visibleOptions.map((option) => <label key={option.key}><input type="checkbox" aria-label={option.label} checked={selected === null || selected.has(option.key)} onChange={() => onToggle(option.key)} /><span>{option.label}</span><span className="workspace-filter-option-count">{option.count}</span></label>)}
        {!visibleOptions.length && <p>沒有符合的值</p>}
      </div>
    </>}
  </WorkspaceModal>;
};
export const NameDialog = ({ state, onClose, onSubmit, onDelete }: { state: NameDialogState; onClose(): void; onSubmit(name: string): void; onDelete?(): void }) => {
  const [name, setName] = useState(state.initialValue);
  const isMultiline = state.mode === 'row' || state.mode === 'axis';
  const label = state.mode === 'folder' ? '資料夾名稱' : state.mode === 'table' ? '表格名稱' : state.mode === 'row' ? '物件名稱' : state.mode === 'axis' ? '物件軸名稱' : '名稱';
  const title = state.mode === 'folder' ? '新增資料夾' : state.mode === 'table' ? '新增表格' : state.mode === 'row' ? '編輯物件名稱' : state.mode === 'axis' ? '編輯物件軸' : '重新命名';
  const finish = () => { const value = name.trim(); if (value) onSubmit(value); else onClose(); };
  return <WorkspaceModal title={title} onClose={finish} className={isMultiline ? 'workspace-cell-name-dialog' : 'workspace-name-dialog'} leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
    <label className="workspace-form-field">{label}{isMultiline
      ? <AutoGrowTextarea autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(); } }} />
      : <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finish(); } }} />}</label>
  </WorkspaceModal>;
};
export const ConfirmDialog = ({ title, message, onClose, onConfirm }: { title: string; message: string; onClose(): void; onConfirm(): void }) => <WorkspaceModal title={title} onClose={onClose} className="workspace-confirm-dialog" leadingAction={<button type="button" className="workspace-dialog-delete" onClick={onConfirm} aria-label="確認刪除"><WorkspaceIcon name="trash" size={20} /></button>}><p className="workspace-dialog-message">{message}</p></WorkspaceModal>;
export const WorkspaceSelectionDialog = ({ column, value, options, onClose, onSelect }: { column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; onClose(): void; onSelect(value: string): void }) => {
  const isMultiple = Boolean(column.isMultiple);
  const isDynamic = column.inputType === 'dynamic-select';
  const [query, setQuery] = useState('');
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set(isMultiple ? parseMultiSelectValues(value) : [value == null ? '' : String(value)]));
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? options.filter((option) => option.toLocaleLowerCase().includes(normalized)) : options;
  }, [options, query]);

  const normalizedQuery = query.trim();

  const toggleOption = (option: string) => {
    if (!isMultiple) {
      onSelect(option);
      return;
    }
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      return next;
    });
  };

  const submitQuery = () => {
    if (!normalizedQuery) return;
    const existingOption = options.find((option) => option.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());
    const optionToAdd = existingOption ?? normalizedQuery;
    if (isMultiple) {
      setSelectedSet((prev) => new Set([...prev, optionToAdd]));
      setQuery('');
    } else {
      onSelect(optionToAdd);
    }
  };

  const saveMultiple = () => {
    onSelect(formatMultiSelectValues(Array.from(selectedSet)));
  };

  const selectAll = () => setSelectedSet(new Set(options));
  const clearAll = () => setSelectedSet(new Set());

  const finish = () => {
    if (isMultiple) {
      saveMultiple();
    } else if (isDynamic && normalizedQuery) {
      submitQuery();
    } else {
      onClose();
    }
  };

  return <WorkspaceModal title={column.name} onClose={finish} className="workspace-selection-dialog">
    {(isDynamic || isMultiple) && <label className="workspace-selection-search"><WorkspaceIcon name="search" size={20} /><span className="sr-only">搜尋或新增選項</span><input ref={inputRef} inputMode="text" enterKeyHint="done" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitQuery(); } }} placeholder="搜尋或輸入…" /><button type="button" onClick={() => setQuery('')} aria-label="清除搜尋"><WorkspaceIcon name="close" size={18} /></button></label>}
    {isMultiple && <div className="workspace-selection-actions"><button type="button" onClick={selectAll}>全選</button><button type="button" onClick={clearAll}>清空</button></div>}
    <div className={`workspace-selection-list ${isDynamic || isMultiple ? 'with-search' : ''}`} role="listbox" aria-label={`${column.name}選項`}>
      {filtered.map((option, index) => {
        const isSelected = selectedSet.has(option);
        return <button ref={!isMultiple && isSelected ? selectedOptionRef : undefined} type="button" key={`${index}-${option}`} role="option" aria-selected={isSelected} className={isSelected ? 'selected' : ''} onClick={() => toggleOption(option)}>
          {isMultiple && <input type="checkbox" checked={isSelected} readOnly aria-label={option} style={{ marginRight: 8, pointerEvents: 'none' }} />}
          <span>{option}</span>
        </button>;
      })}
      {!filtered.length && !(isDynamic && normalizedQuery) && <p className="workspace-selection-empty">目前沒有可選項目</p>}
    </div>
    {isMultiple && <div className="workspace-dialog-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
      <button type="button" className="workspace-dialog-button secondary" onClick={onClose}>取消</button>
      <button type="button" className="workspace-dialog-button primary" onClick={saveMultiple}>確定 ({selectedSet.size})</button>
    </div>}
  </WorkspaceModal>;
};
export const SelectionOptionsEditor = ({ options, onChange }: { options: string[]; onChange(options: string[]): void }) => {
  const visibleOptions = options.length ? options : [''];
  const updateOption = (index: number, value: string) => {
    const next = options.length ? [...options] : [''];
    next[index] = value;
    onChange(next);
  };
  const addOption = () => onChange([...options, '']);
  const removeOption = (index: number) => onChange(options.filter((_, optionIndex) => optionIndex !== index));
  const moveOption = (index: number, direction: -1 | 1) => {
    const next = options.length ? [...options] : [''];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  };

  return <div className="workspace-option-list">
    {visibleOptions.map((option, index) => <div className="workspace-option-row" key={index}>
      <AutoGrowTextarea value={option} aria-label={`固定選項 ${index + 1}`} placeholder={`選項 ${index + 1}`} onChange={(event) => updateOption(index, event.target.value)} />
      <div className="workspace-option-controls">
        <button type="button" onClick={() => moveOption(index, -1)} disabled={index === 0} aria-label={`向上移動固定選項 ${index + 1}`}><WorkspaceIcon name="up" size={17} /></button>
        <button type="button" onClick={() => moveOption(index, 1)} disabled={index === visibleOptions.length - 1} aria-label={`向下移動固定選項 ${index + 1}`}><WorkspaceIcon name="down" size={17} /></button>
        <button type="button" className="workspace-option-remove" onClick={() => removeOption(index)} aria-label={`移除固定選項 ${index + 1}`}><WorkspaceIcon name="close" size={18} /></button>
      </div>
    </div>)}
    <button type="button" className="workspace-option-add" onClick={addOption}><WorkspaceIcon name="plus" size={18} />新增選項</button>
  </div>;
};
export const ColumnConfig = ({ column, onSave, onDelete }: { column: WorkspaceColumn; onSave(column: WorkspaceColumn): void; onDelete?(): void }) => {
  const [draft, setDraft] = useState(column);
  const save = () => onSave({ ...draft, name: draft.name.trim() || '未命名屬性', options: draft.options.map((option) => option.trim()).filter(Boolean), overflowMode: draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap') });
  const category = inputCategoryFor(draft.inputType);
  const chooseInputCategory = (nextCategory: WorkspaceInputCategory) => setDraft((current) => {
    const currentCategory = inputCategoryFor(current.inputType);
    const nextType = currentCategory === nextCategory ? current.inputType : defaultInputTypeFor(nextCategory);
    return { ...current, inputType: nextType, overflowMode: nextType === 'link' && current.overflowMode === 'wrap' ? 'ellipsis' : current.overflowMode };
  });
  const chooseInputSubtype = (inputType: WorkspaceInputType) => setDraft((current) => ({ ...current, inputType, overflowMode: inputType === 'link' && current.overflowMode === 'wrap' ? 'ellipsis' : current.overflowMode }));
  return <WorkspaceModal title="屬性設定" onClose={save} className="workspace-column-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除屬性"><WorkspaceIcon name="trash" size={20} /></button>}>
    <div className="workspace-column-config">
      <div className="workspace-column-config-rail">
        <label className="workspace-form-field">屬性名稱<AutoGrowTextarea value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <fieldset className="workspace-form-field workspace-input-type-field"><legend>輸入類型</legend><div className="workspace-input-type-options">{(Object.entries(inputCategoryLabels) as Array<[WorkspaceInputCategory, string]>).map(([value, label]) => <button type="button" key={value} className={category === value ? 'selected' : ''} onClick={() => chooseInputCategory(value)}>{label}</button>)}</div></fieldset>
        <fieldset className="workspace-form-field workspace-alignment-field"><legend>文字位置</legend><div className="workspace-alignment-options">{(['left', 'center', 'right'] as WorkspaceTextAlign[]).map((alignment) => <button type="button" key={alignment} className={(draft.alignment ?? 'left') === alignment ? 'selected' : ''} onClick={() => setDraft((current) => ({ ...current, alignment }))} aria-label={alignment === 'left' ? '置左' : alignment === 'center' ? '置中' : '置右'}><WorkspaceIcon name={alignment === 'left' ? 'align-left' : alignment === 'center' ? 'align-center' : 'align-right'} size={19} /></button>)}</div></fieldset>
        <fieldset className="workspace-form-field workspace-overflow-field"><legend>內容顯示</legend><div className="workspace-overflow-options">{(Object.entries(overflowModeLabels) as Array<[WorkspaceOverflowMode, string]>).map(([mode, label]) => <button type="button" key={mode} className={(draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap')) === mode ? 'selected' : ''} onClick={() => setDraft((current) => ({ ...current, overflowMode: mode }))}>{label}</button>)}</div></fieldset>
      </div>
      <div className="workspace-column-config-panel">
        <div className="workspace-input-subtype-options" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>{inputSubtypeLabels[category].map(({ value, label }) => <button type="button" key={value} className={draft.inputType === value ? 'selected' : ''} onClick={() => chooseInputSubtype(value)}>{label}</button>)}</div>
          {(draft.inputType === 'select' || draft.inputType === 'dynamic-select') && <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}><input type="checkbox" checked={Boolean(draft.isMultiple)} onChange={(event) => setDraft((current) => ({ ...current, isMultiple: event.target.checked }))} />允許多選</label>}
        </div>
        {draft.inputType === 'select' && <SelectionOptionsEditor options={draft.options} onChange={(options) => setDraft((current) => ({ ...current, options }))} />}
      </div>
    </div>
  </WorkspaceModal>;
};
export interface CellInputDialogProps {
  column: WorkspaceColumn;
  value: WorkspaceCellValue;
  inputLabel?: string;
  onDelete?(): void;
  onSave(value: string): void;
}
