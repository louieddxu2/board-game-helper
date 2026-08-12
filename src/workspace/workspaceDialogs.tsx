import { useEffect, useMemo, useRef, useState } from "react";
import { coerceCellValue, displayWorkspaceCellValue, formatMultiSelectValues, isWorkspaceColor, isWorkspaceLinkValue, normalizeWorkspaceDateTime, parseMultiSelectValues, workspaceCellColor, workspaceDateTimeFromParts, workspaceDateTimeParts, workspaceOptionColor } from "./model";
import { WorkspaceCellValue, WorkspaceColumn, WorkspaceInputType, WorkspaceLinkValue, WorkspaceNumberRange, WorkspaceOverflowMode, WorkspaceRow, WorkspaceTextAlign } from "./types";
import { AutoGrowTextarea, defaultInputTypeFor, HeaderFilterAggregate, HeaderFilterOption, HeaderFilterState, inputCategoryFor, inputCategoryLabels, inputSubtypeLabels, NameDialogState, overflowModeLabels, workspaceColorPalette, WorkspaceIcon, WorkspaceInputCategory, WorkspaceModal } from "./workspaceShared";

export const CellInputDialog = ({ column, value, inputLabel, onDelete, onSave }: CellInputDialogProps) => {
  const [draft, setDraft] = useState(() => column.inputType === 'datetime' ? normalizeWorkspaceDateTime(value) ?? new Date().toISOString() : displayWorkspaceCellValue(value, column.inputType));
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    if (column.inputType === 'datetime') return;
    const input = inputRef.current;
    input?.focus();
    if (input instanceof HTMLInputElement) input.select();
    else input?.setSelectionRange(0, input.value.length);
  }, [column.inputType]);

  const commit = () => onSave(draft);
  return <WorkspaceModal title={column.name} onClose={commit} className={`workspace-value-dialog ${column.inputType === 'datetime' ? 'workspace-datetime-dialog' : ''}`} leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
    {column.inputType === 'datetime'
      ? <DateTimeWheelEditor value={draft} ariaLabel={inputLabel ?? `${column.name}日期時間`} onChange={setDraft} onClear={() => setDraft('')} />
      : column.inputType === 'number'
      ? <input ref={inputRef as React.RefObject<HTMLInputElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input" type="number" inputMode="decimal" enterKeyHint="done" step="any" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
      : <AutoGrowTextarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input workspace-value-textarea" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); } }} />}
  </WorkspaceModal>;
};

const range = (start: number, end: number) => Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);

const WheelPicker = ({ label, value, options, onChange, loop = false }: { label: string; value: number; options: number[]; onChange(value: number): void; loop?: boolean }) => {
  const dragRef = useRef<{ pointerId: number; startY: number; lastStep: number } | undefined>(undefined);
  const index = Math.max(0, options.indexOf(value));
  const valueAt = (offset: number) => {
    if (!options.length) return undefined;
    let nextIndex = index + offset;
    if (loop) nextIndex = (nextIndex % options.length + options.length) % options.length;
    if (nextIndex < 0 || nextIndex >= options.length) return undefined;
    return options[nextIndex];
  };
  const moveBy = (delta: number) => {
    const nextIndex = index + delta;
    if (loop) {
      onChange(options[(nextIndex % options.length + options.length) % options.length]);
      return;
    }
    if (nextIndex >= 0 && nextIndex < options.length) onChange(options[nextIndex]);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
  };
  return <div className="workspace-datetime-wheel" role="listbox" aria-label={label} tabIndex={0}
    onWheel={(event) => { event.preventDefault(); moveBy(event.deltaY > 0 ? 1 : -1); }}
    onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveBy(event.key === 'ArrowDown' ? 1 : -1); } }}
    onPointerDown={(event) => { if (event.button !== 0) return; dragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastStep: 0 }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
    onPointerMove={(event) => { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; const step = Math.trunc((drag.startY - event.clientY) / 22); if (step !== drag.lastStep) { moveBy(step - drag.lastStep); drag.lastStep = step; } }}
    onPointerUp={endDrag} onPointerCancel={endDrag}>
    {[-1, 0, 1].map((offset) => {
      const option = valueAt(offset);
      return option === undefined
        ? <span className="workspace-datetime-wheel-empty" aria-hidden="true" key={offset} />
        : <button type="button" role="option" aria-selected={offset === 0} className={offset === 0 ? 'selected' : ''} key={option} onClick={() => onChange(option)}>{String(option)}</button>;
    })}
    <span className="workspace-datetime-wheel-unit">{label}</span>
  </div>;
};

export const DateTimeWheelEditor = ({ value, ariaLabel, onChange, onClear }: { value: WorkspaceCellValue; ariaLabel: string; onChange(value: string): void; onClear?(): void }) => {
  const [parts, setParts] = useState(() => workspaceDateTimeParts(value));
  const currentYear = new Date().getFullYear();
  const daysInMonth = new Date(parts.year, parts.month, 0).getDate();
  const updatePart = (key: keyof typeof parts, value: number) => {
    const next = { ...parts, [key]: value };
    if (key === 'year' || key === 'month') next.day = Math.min(next.day, new Date(next.year, next.month, 0).getDate());
    const normalized = workspaceDateTimeFromParts(next);
    if (!normalized) return;
    setParts(next);
    onChange(normalized);
  };
  return <div className="workspace-datetime-editor" role="group" aria-label={ariaLabel}>
    <div className="workspace-datetime-wheel-row" aria-label="日期">
      <WheelPicker label="年" value={parts.year} options={range(Math.min(currentYear - 100, parts.year - 2), Math.max(currentYear + 100, parts.year + 2))} onChange={(next) => updatePart('year', next)} />
      <WheelPicker label="月" value={parts.month} options={range(1, 12)} loop onChange={(next) => updatePart('month', next)} />
      <WheelPicker label="日" value={parts.day} options={range(1, daysInMonth)} loop onChange={(next) => updatePart('day', next)} />
    </div>
    <div className="workspace-datetime-divider" aria-hidden="true" />
    <div className="workspace-datetime-wheel-row" aria-label="時間">
      <WheelPicker label="時" value={parts.hour} options={range(0, 23)} loop onChange={(next) => updatePart('hour', next)} />
      <WheelPicker label="分" value={parts.minute} options={range(0, 59)} loop onChange={(next) => updatePart('minute', next)} />
    </div>
    <div className="workspace-datetime-footer">
      <button type="button" className="workspace-datetime-clear" onClick={() => onClear?.()} aria-label={`${ariaLabel}清除`}>清除</button>
      <span className="workspace-datetime-timezone">依裝置時區</span>
    </div>
  </div>;
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
  const isText = inputType === 'text';
  const isNumber = inputType === 'number';
  const isDate = inputType === 'datetime';
  const visibleOptions = useMemo(() => {
    const normalized = optionQuery.trim().toLocaleLowerCase();
    return normalized && !isDate ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalized)) : options;
  }, [isDate, options, optionQuery]);
  const selected = state.includedKeys === null ? null : new Set(state.includedKeys);
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
    {isDate && <>
      <div className="workspace-filter-date-range" role="group" aria-label={`${label}日期範圍`}>
        <label>開始日期<input type="date" aria-label={`${label}開始日期`} value={state.min ?? ''} onChange={(event) => onRange(event.target.value, state.max ?? '')} /></label>
        <span aria-hidden="true">至</span>
        <label>結束日期<input type="date" aria-label={`${label}結束日期`} value={state.max ?? ''} onChange={(event) => onRange(state.min ?? '', event.target.value)} /></label>
      </div>
      <div className="workspace-filter-selection-actions"><button type="button" onClick={onSelectAll}>全部年月</button><button type="button" onClick={onClearAll}>清除年月</button></div>
      <div className="workspace-filter-options" role="group" aria-label={`${label}年月篩選`}>
        {visibleOptions.map((option) => <label key={option.key}><input type="checkbox" aria-label={option.label} checked={selected === null || selected.has(option.key)} onChange={() => onToggle(option.key)} /><span>{option.label}</span><span className="workspace-filter-option-count">{option.count}</span></label>)}
        {!visibleOptions.length && <p>沒有日期資料</p>}
      </div>
    </>}
    {!isText && !isNumber && !isDate && <>
      <label className="workspace-filter-search"><WorkspaceIcon name="search" size={19} /><span className="sr-only">搜尋{label}的值</span><input type="search" aria-label={`搜尋${label}的值`} value={optionQuery} onChange={(event) => setOptionQuery(event.target.value)} /></label>
      <div className="workspace-filter-selection-actions"><button type="button" onClick={onSelectAll}>全部</button><button type="button" onClick={onClearAll}>清除</button></div>
      <div className="workspace-filter-options" role="group" aria-label={`${label}篩選值`}>
        {visibleOptions.map((option) => <label key={option.key}><input type="checkbox" aria-label={option.label} checked={selected === null || selected.has(option.key)} onChange={() => onToggle(option.key)} /><span style={{ color: option.color }}>{option.label}</span><span className="workspace-filter-option-count">{option.count}</span></label>)}
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
        if (isMultiple) {
          return <label key={`${index}-${option}`} className={`workspace-selection-checkbox-item ${isSelected ? 'selected' : ''}`}>
            <input type="checkbox" checked={isSelected} onChange={() => toggleOption(option)} />
            <span className="workspace-selection-checkbox-label" style={{ color: workspaceOptionColor(column, option) }}>{option}</span>
          </label>;
        }
        return <button ref={isSelected ? selectedOptionRef : undefined} type="button" key={`${index}-${option}`} role="option" aria-selected={isSelected} className={isSelected ? 'selected' : ''} onClick={() => toggleOption(option)}>
          <span style={{ color: workspaceOptionColor(column, option) }}>{option}</span>
        </button>;
      })}
      {!filtered.length && !(isDynamic && normalizedQuery) && <p className="workspace-selection-empty">目前沒有可選項目</p>}
    </div>
    <div className="workspace-selection-clear-row"><button type="button" onClick={() => onSelect('')}>清除</button></div>
    {isMultiple && <div className="workspace-dialog-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 14px' }}>
      <button type="button" className="workspace-dialog-button secondary" onClick={onClose}>取消</button>
      <button type="button" className="workspace-dialog-button primary" onClick={saveMultiple}>確定 ({selectedSet.size})</button>
    </div>}
  </WorkspaceModal>;
};
export const ColumnVisibilityDialog = ({ columns, onClose, onToggle }: { columns: WorkspaceColumn[]; onClose(): void; onToggle(columnId: string): void }) => <WorkspaceModal title="欄位顯示設定" onClose={onClose} className="workspace-column-visibility-dialog">
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
  if (column.inputType === 'datetime') return <DateTimeWheelEditor value={value} ariaLabel={`${column.name}日期時間`} onChange={(next) => onChange(coerceCellValue(column, next))} onClear={() => onChange(null)} />;
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
  return <WorkspaceModal title={title || '物件'} onClose={() => onSave(draft)} className="workspace-hidden-fields-dialog">
    <div className="workspace-hidden-fields-list">
      {columns.map((column) => <div className="workspace-hidden-field" key={column.id}>
        <span className="workspace-hidden-field-label">{column.name || '未命名屬性'}</span>
        <HiddenFieldEditor column={column} value={draft[column.id] ?? null} options={optionsByColumn[column.id] ?? []} onChange={(value) => updateValue(column.id, value)} />
      </div>)}
      {!columns.length && <p className="workspace-hidden-fields-empty">目前沒有隱藏欄位</p>}
    </div>
  </WorkspaceModal>;
};

export const WorkspaceColorPalette = ({ value, onChange, ariaLabel }: { value: string; onChange(value: string): void; ariaLabel: string }) => {
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>();
  const selected = workspaceColorPalette.find((color) => color.value === value);

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', closeWhenOutside);
    return () => window.removeEventListener('pointerdown', closeWhenOutside);
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 168;
      setMenuPosition({
        top: Math.min(window.innerHeight - 56, rect.bottom + 4),
        left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth)),
      });
    }
    setOpen(true);
  };

  return <div ref={pickerRef} className="workspace-color-palette" role="group" aria-label={ariaLabel}>
    <button ref={triggerRef} type="button" className="workspace-color-picker-trigger" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={toggleMenu}>
      <span className={`workspace-color-swatch ${value ? '' : 'default'}`} style={value ? { backgroundColor: value } : undefined} />
    </button>
    {open && <div className="workspace-color-menu" role="menu" aria-label={`${ariaLabel}選單`} style={menuPosition ? { top: menuPosition.top, left: menuPosition.left } : undefined}>
      {workspaceColorPalette.map((color) => <button type="button" role="menuitem" key={color.label} className={value === color.value ? 'selected' : ''} aria-label={color.label} aria-checked={value === color.value} onClick={() => { onChange(color.value); setOpen(false); }}>
        <span className={`workspace-color-swatch ${color.value ? '' : 'default'}`} style={color.value ? { backgroundColor: color.value } : undefined} />
      </button>)}
    </div>}
  </div>;
};

export const NumberRangeEditor = ({ ranges, onChange }: { ranges: WorkspaceNumberRange[]; onChange(ranges: WorkspaceNumberRange[]): void }) => {
  const updateRange = (index: number, field: 'min' | 'max', raw: string) => {
    const trimmed = raw.trim();
    const parsed = trimmed ? Number(trimmed) : null;
    const value = parsed === null || Number.isFinite(parsed) ? parsed : null;
    onChange(ranges.map((range, rangeIndex) => rangeIndex === index ? { ...range, [field]: value } : range));
  };
  return <div className="workspace-number-range-editor">
    <div className="workspace-number-range-heading"><span>數字範圍顏色</span><button type="button" className="workspace-option-add" onClick={() => onChange([...ranges, { min: null, max: null, color: '' }])}><WorkspaceIcon name="plus" size={17} />新增範圍</button></div>
    {!ranges.length && <p className="workspace-number-range-empty">尚未設定範圍</p>}
    {ranges.map((range, index) => <div className="workspace-number-range-row" key={index}>
      <div className="workspace-number-range-inputs">
        <input type="number" inputMode="decimal" step="any" value={range.min ?? ''} placeholder="−∞" aria-label={`第 ${index + 1} 段下限`} onChange={(event) => updateRange(index, 'min', event.target.value)} />
        <span>～</span>
        <input type="number" inputMode="decimal" step="any" value={range.max ?? ''} placeholder="＋∞" aria-label={`第 ${index + 1} 段上限`} onChange={(event) => updateRange(index, 'max', event.target.value)} />
      </div>
      <WorkspaceColorPalette value={range.color} onChange={(color) => onChange(ranges.map((item, rangeIndex) => rangeIndex === index ? { ...item, color } : item))} ariaLabel={`第 ${index + 1} 段顏色`} />
      <button type="button" className="workspace-option-remove" aria-label={`刪除第 ${index + 1} 段範圍`} onClick={() => onChange(ranges.filter((_, rangeIndex) => rangeIndex !== index))}><WorkspaceIcon name="trash" size={17} /></button>
    </div>)}
  </div>;
};

export const SelectionOptionsEditor = ({ options, optionColors, onChange }: { options: string[]; optionColors?: Record<string, string>; onChange(options: string[], optionColors: Record<string, string>): void }) => {
  const visibleOptions = options.length ? options : [''];
  const visibleColors = visibleOptions.map((option) => optionColors?.[option] ?? '');
  const optionListRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<{ pointerId: number; currentIndex: number; active: boolean; startY: number } | undefined>(undefined);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const optionStateRef = useRef({ options: visibleOptions, colors: visibleColors });
  const onChangeRef = useRef(onChange);
  optionStateRef.current = { options: visibleOptions, colors: visibleColors };
  onChangeRef.current = onChange;
  const emit = (nextOptions: string[], nextColors: string[]) => {
    const nextOptionColors: Record<string, string> = {};
    nextOptions.forEach((option, index) => {
      const key = option.trim();
      if (key && nextColors[index]) nextOptionColors[key] = nextColors[index];
    });
    onChange(nextOptions, nextOptionColors);
  };
  const updateOption = (index: number, value: string) => {
    const next = [...visibleOptions];
    next[index] = value;
    emit(next, visibleColors);
  };
  const updateOptionColor = (index: number, color: string) => {
    const nextColors = [...visibleColors];
    nextColors[index] = color;
    emit(visibleOptions, nextColors);
  };
  const addOption = () => emit([...visibleOptions, ''], [...visibleColors, '']);
  const removeOption = (index: number) => {
    const next = visibleOptions.filter((_, optionIndex) => optionIndex !== index);
    emit(next.length ? next : [''], visibleColors.filter((_, optionIndex) => optionIndex !== index));
  };
  const reorderOption = (sourceIndex: number, destination: number) => {
    const { options: currentOptions, colors: currentColors } = optionStateRef.current;
    if (sourceIndex === destination || sourceIndex < 0 || destination < 0 || sourceIndex >= currentOptions.length || destination >= currentOptions.length) return;
    const nextOptions = [...currentOptions];
    const nextColors = [...currentColors];
    [nextOptions[sourceIndex], nextOptions[destination]] = [nextOptions[destination], nextOptions[sourceIndex]];
    [nextColors[sourceIndex], nextColors[destination]] = [nextColors[destination], nextColors[sourceIndex]];
    onChangeRef.current(nextOptions, Object.fromEntries(nextOptions.map((option, index) => [option.trim(), nextColors[index]]).filter(([option, color]) => Boolean(option) && Boolean(color))));
    optionStateRef.current = { options: nextOptions, colors: nextColors };
    dragSessionRef.current!.currentIndex = destination;
    setDraggingIndex(destination);
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const distance = Math.abs(event.clientY - session.startY);
      if (!session.active && distance < 6) return;
      session.active = true;
      const items = Array.from(optionListRef.current?.querySelectorAll<HTMLElement>('[data-option-index]') ?? []);
      const destination = items.findIndex((item) => event.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
      reorderOption(session.currentIndex, destination === -1 ? items.length - 1 : destination);
    };
    const end = (event: PointerEvent) => {
      if (dragSessionRef.current?.pointerId !== event.pointerId) return;
      dragSessionRef.current = undefined;
      setDraggingIndex(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  });
  const beginOptionDrag = (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragSessionRef.current = { pointerId: event.pointerId, currentIndex: index, active: false, startY: event.clientY };
    setDraggingIndex(index);
  };

  return <div ref={optionListRef} className="workspace-option-list">
    {visibleOptions.map((option, index) => <div className={`workspace-option-row ${draggingIndex === index ? 'is-dragging' : ''}`} data-option-index={index} key={index}>
      <button type="button" className="workspace-option-drag-handle" aria-label={`拖曳固定選項 ${index + 1}`} onPointerDown={(event) => beginOptionDrag(index, event)}><WorkspaceIcon name="more" size={20} /></button>
      <div className="workspace-option-editor"><AutoGrowTextarea value={option} aria-label={`固定選項 ${index + 1}`} placeholder={`選項 ${index + 1}`} onChange={(event) => updateOption(index, event.target.value)} /></div>
      <div className="workspace-option-controls">
        <WorkspaceColorPalette value={visibleColors[index]} onChange={(color) => updateOptionColor(index, color)} ariaLabel={`固定選項 ${index + 1} 顏色`} />
        <button type="button" className="workspace-option-remove" onClick={() => removeOption(index)} aria-label={`移除固定選項 ${index + 1}`}><WorkspaceIcon name="close" size={18} /></button>
      </div>
    </div>)}
    <button type="button" className="workspace-option-add" onClick={addOption}><WorkspaceIcon name="plus" size={18} />新增選項</button>
  </div>;
};
export const ColumnConfig = ({ column, onSave, onDelete }: { column: WorkspaceColumn; onSave(column: WorkspaceColumn): void; onDelete?(): void }) => {
  const [draft, setDraft] = useState(column);
  const save = () => {
    const options = draft.options.map((option) => option.trim()).filter(Boolean);
    const optionColors = Object.fromEntries(Object.entries(draft.optionColors ?? {}).map(([option, color]) => [option.trim(), color]).filter(([option, color]) => Boolean(option) && isWorkspaceColor(color)));
    onSave({ ...draft, name: draft.name.trim(), options, optionColors, numberRanges: draft.numberRanges ?? [], overflowMode: draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap') });
  };
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
          {(draft.inputType === 'select' || draft.inputType === 'dynamic-select') && <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}><input type="checkbox" checked={Boolean(draft.isMultiple)} onChange={(event) => setDraft((current) => ({ ...current, isMultiple: event.target.checked }))} />多選</label>}
        </div>
        {draft.inputType === 'select' && <SelectionOptionsEditor options={draft.options} optionColors={draft.optionColors} onChange={(options, optionColors) => setDraft((current) => ({ ...current, options, optionColors }))} />}
        {draft.inputType === 'number' && <NumberRangeEditor ranges={draft.numberRanges ?? []} onChange={(numberRanges) => setDraft((current) => ({ ...current, numberRanges }))} />}
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
