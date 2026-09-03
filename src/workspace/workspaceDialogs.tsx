import { Fragment, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { coerceCellValue, displayWorkspaceCellValue, formatMultiSelectValues, getWorkspaceNumberInputMode, isWorkspaceColor, isWorkspaceLinkValue, normalizeWorkspaceDateTime, parseMultiSelectValues, workspaceCellColor, workspaceDateTimeFromParts, workspaceDateTimeParts, workspaceOptionColor } from "./model";
import { WorkspaceCellValue, WorkspaceColumn, WorkspaceInputType, WorkspaceLinkValue, WorkspaceNumberRange, WorkspaceOverflowMode, WorkspaceRow, WorkspaceTextAlign } from "./types";
import { AutoGrowTextarea, defaultInputTypeFor, HeaderFilterAggregate, HeaderFilterOption, HeaderFilterState, inputCategoryFor, inputCategoryLabels, inputSubtypeLabels, NameDialogState, numberInputModeLabels, overflowModeLabels, workspaceColorPalette, WorkspaceIcon, WorkspaceInputCategory, WorkspaceModal } from "./workspaceShared";
import { DRAG_SCROLL_INTENT_DISTANCE, useDragEdgeAutoScroll } from './useDragEdgeAutoScroll';

type NumericEditMode = 'direct' | 'add' | 'subtract';

interface DecimalParts {
  sign: 1 | -1;
  integer: string;
  fraction: string;
  scaled: bigint;
  scale: number;
}

const decimalPattern = /^([+-]?)(\d*)(?:\.(\d*))?$/;
const parseDecimal = (raw: string): DecimalParts | null => {
  const match = decimalPattern.exec(raw.trim());
  if (!match || (!match[2] && !match[3])) return null;
  const fraction = match[3] ?? '';
  const integer = (match[2] || '0').replace(/^0+(?=\d)/, '');
  const sign: 1 | -1 = match[1] === '-' ? -1 : 1;
  const digits = `${integer}${fraction}` || '0';
  const magnitude = BigInt(digits);
  return { sign, integer, fraction, scaled: sign === -1 ? -magnitude : magnitude, scale: fraction.length };
};

const decimalScale = (raw: string) => parseDecimal(raw)?.scale ?? 0;
const rescaleDecimal = (value: bigint, fromScale: number, toScale: number) => value * (10n ** BigInt(toScale - fromScale));
const formatDecimal = (value: bigint, scale: number) => {
  const negative = value < 0n;
  const magnitude = (negative ? -value : value).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative && value !== 0n ? '-' : ''}${magnitude}`;
  const integer = magnitude.slice(0, -scale) || '0';
  const fraction = magnitude.slice(-scale);
  return `${negative && value !== 0n ? '-' : ''}${integer}.${fraction}`;
};

const calculateNumericAdjustment = (original: string, delta: string, mode: NumericEditMode) => {
  if (mode === 'direct') return null;
  const base = parseDecimal(original.trim() || '0');
  const change = parseDecimal(delta.trim() || '0');
  if (!base || !change) return null;
  const scale = Math.max(base.scale, change.scale);
  const baseValue = rescaleDecimal(base.scaled, base.scale, scale);
  const changeValue = rescaleDecimal(change.scaled, change.scale, scale);
  return formatDecimal(baseValue + (mode === 'add' ? changeValue : -changeValue), scale);
};

const NumericAlignedValue = ({ value }: { value: string }) => {
  const parts = parseDecimal(value);
  if (!parts) return <span className="workspace-number-aligned-value">{value}</span>;
  return <span className="workspace-number-aligned-value" aria-label={value}>
    <span className="workspace-number-integer">{parts.sign === -1 ? '-' : ''}{parts.integer}</span>
    <span className="workspace-number-decimal">{parts.fraction ? '.' : ''}</span>
    <span className="workspace-number-fraction">{parts.fraction}</span>
  </span>;
};

export interface NumericCellEditorHandle {
  commit(): void;
}

const NumericCellEditor = forwardRef<NumericCellEditorHandle, Pick<CellInputDialogProps, 'column' | 'value' | 'inputLabel' | 'onDismiss' | 'onSave'>>(({ column, value, inputLabel, onDismiss, onSave }, forwardedRef) => {
  const initialDraft = displayWorkspaceCellValue(value, column.inputType);
  const adjustmentEnabled = getWorkspaceNumberInputMode(column) === 'adjust';
  const [mode, setMode] = useState<NumericEditMode>('direct');
  const [draft, setDraft] = useState(initialDraft);
  const [originalDraft, setOriginalDraft] = useState(initialDraft);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseLabel = inputLabel ?? `${column.name}輸入`;
  const result = calculateNumericAdjustment(originalDraft, draft, mode);
  const fractionDigits = Math.max(2, decimalScale(originalDraft), decimalScale(draft), result ? decimalScale(result) : 0);
  const inputDecimal = parseDecimal(draft);

  const focusInput = (select = false) => {
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      if (select) input?.select();
    });
  };
  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const chooseMode = (nextMode: Exclude<NumericEditMode, 'direct'>) => {
    const enteringAdjustment = mode === 'direct';
    if (mode === 'direct') {
      setOriginalDraft(draft);
      setDraft('0');
    } else if (!draft.trim()) {
      setDraft('0');
    }
    setMode(nextMode);
    focusInput(enteringAdjustment);
  };
  const restoreOriginal = () => {
    setMode('direct');
    setDraft(originalDraft);
    focusInput(true);
  };
  const commit = () => {
    if (mode === 'direct') {
      onSave(draft);
      return;
    }
    if (!result) {
      onDismiss?.();
      return;
    }
    onSave(result);
  };
  useImperativeHandle(forwardedRef, () => ({ commit }), [commit]);

  return <div className="workspace-number-editor-shell">
    <div className="workspace-number-editor" data-mode={mode} style={{ '--workspace-number-fraction-width': `${fractionDigits}ch` } as React.CSSProperties}>
    {mode !== 'direct' && <button type="button" className="workspace-number-original" aria-label={`編輯原始數值 ${originalDraft || '空白'}`} onPointerDown={(event) => event.preventDefault()} onClick={restoreOriginal}><NumericAlignedValue value={originalDraft} /></button>}
    <div className="workspace-number-input-shell">
      <input ref={inputRef} aria-label={mode === 'direct' ? baseLabel : `${baseLabel}${mode === 'add' ? '加法' : '減法'}`} autoFocus className="workspace-value-input" style={mode === 'direct' || inputDecimal?.fraction ? undefined : { paddingRight: `calc(${fractionDigits}ch + .6ch)` }} type="number" inputMode="decimal" enterKeyHint="done" step="any" min={mode === 'direct' ? undefined : 0} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
    </div>
    {adjustmentEnabled && <div className="workspace-number-operators">
      <button type="button" className={`workspace-number-operation workspace-number-operation-subtract${mode === 'subtract' ? ' is-selected' : ''}`} aria-label={mode === 'direct' ? '減少數值' : '切換為減法'} aria-pressed={mode === 'subtract'} onPointerDown={(event) => event.preventDefault()} onClick={() => chooseMode('subtract')}>−</button>
      <button type="button" className={`workspace-number-operation workspace-number-operation-add${mode === 'add' ? ' is-selected' : ''}`} aria-label={mode === 'direct' ? '增加數值' : '切換為加法'} aria-pressed={mode === 'add'} onPointerDown={(event) => event.preventDefault()} onClick={() => chooseMode('add')}>＋</button>
    </div>}
    {mode !== 'direct' && <output className="workspace-number-result" role="status" aria-label={`${column.name}計算結果`}>{result && <><span aria-hidden="true">→</span><NumericAlignedValue value={result} /></>}</output>}
    </div>
  </div>;
});
NumericCellEditor.displayName = 'NumericCellEditor';

const NumericStepEditor = forwardRef<NumericCellEditorHandle, Pick<CellInputDialogProps, 'column' | 'value' | 'inputLabel' | 'onSave'>>(({ column, value, inputLabel, onSave }, forwardedRef) => {
  const initialDraft = displayWorkspaceCellValue(value, column.inputType);
  const [draft, setDraft] = useState(initialDraft);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseLabel = inputLabel ?? `${column.name}輸入`;
  const fractionDigits = Math.max(2, decimalScale(draft));

  const step = (delta: 1 | -1) => {
    const current = parseDecimal(draft.trim() || '0') ?? parseDecimal('0')!;
    const next = current.scaled + BigInt(delta) * (10n ** BigInt(current.scale));
    setDraft(formatDecimal(next, current.scale));
  };
  const commit = () => onSave(draft);
  useImperativeHandle(forwardedRef, () => ({ commit }), [commit]);

  return <div className="workspace-number-editor-shell">
    <div className="workspace-number-editor" data-mode="step" style={{ '--workspace-number-fraction-width': `${fractionDigits}ch` } as React.CSSProperties}>
      <button type="button" className="workspace-number-operation workspace-number-operation-subtract" aria-label="減少 1" onPointerDown={(event) => event.preventDefault()} onClick={() => step(-1)}>−</button>
      <div className="workspace-number-input-shell">
        <input ref={inputRef} aria-label={baseLabel} className="workspace-value-input" style={{ textAlign: 'center' }} type="number" inputMode="decimal" enterKeyHint="done" step="any" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
      </div>
      <button type="button" className="workspace-number-operation workspace-number-operation-add" aria-label="增加 1" onPointerDown={(event) => event.preventDefault()} onClick={() => step(1)}>＋</button>
    </div>
  </div>;
});
NumericStepEditor.displayName = 'NumericStepEditor';

export const CellInputDialog = ({ column, value, inputLabel, onDelete, onDismiss, onSave, showConfirm = false }: CellInputDialogProps) => {
  const [draft, setDraft] = useState(() => column.inputType === 'datetime' ? normalizeWorkspaceDateTime(value) ?? new Date().toISOString() : displayWorkspaceCellValue(value, column.inputType));
  const [dateDirty, setDateDirty] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const numericEditorRef = useRef<NumericCellEditorHandle>(null);
  useEffect(() => {
    if (column.inputType === 'datetime' || column.inputType === 'number') return;
    const input = inputRef.current;
    input?.focus();
    if (input instanceof HTMLInputElement) input.select();
    else input?.setSelectionRange(0, input.value.length);
  }, [column.inputType]);

  const commit = () => column.inputType === 'datetime' && !dateDirty ? onDismiss?.() : onSave(draft);
  const close = column.inputType === 'number' ? () => numericEditorRef.current?.commit() : commit;
  const dismiss = showConfirm ? (onDismiss ?? (() => undefined)) : close;
  return <WorkspaceModal title={column.name} dialogKind="editor" onClose={dismiss} className={`workspace-value-dialog ${column.inputType === 'datetime' ? 'workspace-datetime-dialog' : ''}`} leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>} actions={showConfirm ? <button type="button" className="workspace-dialog-button primary" onClick={close}>確認</button> : undefined}>
    {column.inputType === 'datetime'
      ? <DateTimeWheelEditor value={draft} ariaLabel={inputLabel ?? `${column.name}${column.dateOnly ? '日期' : '日期時間'}`} showTime={!column.dateOnly} onChange={(next) => { setDraft(next); setDateDirty(true); }} onCurrent={(next) => { if (showConfirm) { setDraft(next); setDateDirty(true); } else onSave(next); }} onClear={() => { if (showConfirm) { setDraft(''); setDateDirty(true); } else onSave(''); }} />
      : column.inputType === 'number'
      ? getWorkspaceNumberInputMode(column) === 'step'
        ? <NumericStepEditor ref={numericEditorRef} column={column} value={value} inputLabel={inputLabel} onSave={onSave} />
        : <NumericCellEditor ref={numericEditorRef} column={column} value={value} inputLabel={inputLabel} onDismiss={onDismiss} onSave={onSave} />
      : <AutoGrowTextarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input workspace-value-textarea" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); } }} />}
  </WorkspaceModal>;
};

const range = (start: number, end: number) => Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);

const WheelPicker = ({ label, value, options, onChange, loop = false, centerEditor, onCenterClick }: { label: string; value: number; options: number[]; onChange(value: number): void; loop?: boolean; centerEditor?: React.ReactNode; onCenterClick?(): void }) => {
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
      if (offset === 0 && centerEditor) return <span className="workspace-datetime-wheel-center-editor" key="center-editor">{centerEditor}</span>;
      return option === undefined
        ? <span className="workspace-datetime-wheel-empty" aria-hidden="true" key={offset} />
        : <button type="button" role="option" aria-selected={offset === 0} className={offset === 0 ? 'selected' : ''} key={option} onClick={() => offset === 0 && onCenterClick ? onCenterClick() : onChange(option)}>{String(option)}</button>;
    })}
    <span className="workspace-datetime-wheel-unit">{label}</span>
  </div>;
};

export const DateTimeWheelEditor = ({ value, ariaLabel, showTime = true, onChange, onCurrent, onClear }: { value: WorkspaceCellValue; ariaLabel: string; showTime?: boolean; onChange(value: string): void; onCurrent?(value: string): void; onClear?(): void }) => {
  const [parts, setParts] = useState(() => workspaceDateTimeParts(value));
  const [editingYear, setEditingYear] = useState(false);
  const [yearDraft, setYearDraft] = useState(() => String(parts.year));
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
  const commitYear = () => {
    const year = Number(yearDraft);
    setEditingYear(false);
    if (Number.isInteger(year) && year >= 1 && year <= 9999) updatePart('year', year);
    else setYearDraft(String(parts.year));
  };
  const setCurrent = () => {
    const now = new Date();
    const next = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: now.getHours(), minute: now.getMinutes() };
    const normalized = workspaceDateTimeFromParts(next);
    if (!normalized) return;
    setParts(next);
    setYearDraft(String(next.year));
    onChange(normalized);
    onCurrent?.(normalized);
  };
  return <div className={`workspace-datetime-editor ${showTime ? '' : 'is-date-only'}`} role="group" aria-label={ariaLabel}>
    <div className="workspace-datetime-wheel-row" aria-label="日期">
      <WheelPicker label="年" value={parts.year} options={range(Math.min(currentYear - 100, parts.year - 2), Math.max(currentYear + 100, parts.year + 2))} onChange={(next) => updatePart('year', next)} onCenterClick={() => { setYearDraft(String(parts.year)); setEditingYear(true); }} centerEditor={editingYear ? <input autoFocus aria-label="輸入年份" className="workspace-datetime-year-input" type="number" inputMode="numeric" min="1" max="9999" value={yearDraft} onChange={(event) => setYearDraft(event.target.value)} onBlur={commitYear} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitYear(); } if (event.key === 'Escape') { setYearDraft(String(parts.year)); setEditingYear(false); } }} /> : undefined} />
      <WheelPicker label="月" value={parts.month} options={range(1, 12)} loop onChange={(next) => updatePart('month', next)} />
      <WheelPicker label="日" value={parts.day} options={range(1, daysInMonth)} loop onChange={(next) => updatePart('day', next)} />
    </div>
    {showTime && <><div className="workspace-datetime-divider" aria-hidden="true" />
      <div className="workspace-datetime-wheel-row" aria-label="時間">
        <WheelPicker label="時" value={parts.hour} options={range(0, 23)} loop onChange={(next) => updatePart('hour', next)} />
        <WheelPicker label="分" value={parts.minute} options={range(0, 59)} loop onChange={(next) => updatePart('minute', next)} />
      </div></>}
    <div className="workspace-datetime-footer">
      <button type="button" className="workspace-datetime-clear" onClick={() => onClear?.()} aria-label={`${ariaLabel}清除`}>清除</button>
      <button type="button" className="workspace-datetime-current" onClick={setCurrent}>{showTime ? '現在' : '今天'}</button>
    </div>
  </div>;
};
export const LinkInputDialog = ({ column, value, onDelete, onSave, onDismiss, showConfirm = false }: { column: WorkspaceColumn; value: WorkspaceCellValue; onDelete?(): void; onSave(value: WorkspaceLinkValue | null): void; onDismiss?(): void; showConfirm?: boolean }) => {
  const initial = isWorkspaceLinkValue(value) ? value : { url: typeof value === 'string' ? value : '', label: '' };
  const [url, setUrl] = useState(initial.url);
  const [label, setLabel] = useState(initial.label);
  const commit = () => onSave(url.trim() || label.trim() ? { url: url.trim(), label: label.trim() } : null);
  const dismiss = showConfirm ? (onDismiss ?? (() => undefined)) : commit;
  return <WorkspaceModal title={column.name} dialogKind="editor" onClose={dismiss} className="workspace-link-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>} actions={showConfirm ? <button type="button" className="workspace-dialog-button primary" onClick={commit}>確認</button> : undefined}>
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
  return <WorkspaceModal title={title} dialogKind="editor" onClose={finish} className={isMultiline ? 'workspace-cell-name-dialog' : 'workspace-name-dialog'} leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
    <label className="workspace-form-field">{label}{isMultiline
      ? <AutoGrowTextarea autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(); } }} />
      : <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finish(); } }} />}</label>
  </WorkspaceModal>;
};
export const ConfirmDialog = ({ title, message, onClose, onConfirm }: { title: string; message: string; onClose(): void; onConfirm(): void }) => <WorkspaceModal title={title} onClose={onClose} className="workspace-confirm-dialog" actions={<><button type="button" className="workspace-dialog-button secondary" onClick={onClose}>取消</button><button type="button" className="workspace-dialog-button danger" onClick={onConfirm}>確認</button></>}><p className="workspace-dialog-message">{message}</p></WorkspaceModal>;
export const WorkspaceSelectionDialog = ({ column, value, options, onClose, onSelect, onChange, onConfirm }: { column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; onClose(): void; onSelect?(value: string): void; onChange?(value: string): void; onConfirm?(value: string): void }) => {
  const isMultiple = Boolean(column.isMultiple);
  const isDynamic = column.inputType === 'dynamic-select';
  const [query, setQuery] = useState('');
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set(isMultiple ? parseMultiSelectValues(value) : [value == null ? '' : String(value)]));
  const inputRef = useRef<HTMLInputElement>(null);

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

  return <WorkspaceModal title={column.name} dialogKind="editor" onClose={finish} className="workspace-selection-dialog" actions={onConfirm ? <button type="button" className="workspace-dialog-button primary" onClick={confirmSelection}>確認</button> : undefined}>
    {isDynamic && <div className="workspace-selection-head">
      <label className="workspace-selection-search"><WorkspaceIcon name="search" size={19} /><span className="sr-only">搜尋或新增選項</span><input ref={inputRef} inputMode="text" enterKeyHint="done" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitQuery(); } }} placeholder="搜尋或輸入…" /><button type="button" onClick={() => setQuery('')} aria-label="清除搜尋" disabled={!query}><WorkspaceIcon name="close" size={17} /></button></label>
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
export const ColumnVisibilityDialog = ({ columns, onClose, onToggle }: { columns: WorkspaceColumn[]; onClose(): void; onToggle(columnId: string): void }) => <WorkspaceModal title="欄位顯示設定" dialogKind="editor" onClose={onClose} className="workspace-column-visibility-dialog">
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
  return <WorkspaceModal title={title || '物件'} dialogKind="editor" onClose={() => onSave(draft)} className="workspace-hidden-fields-dialog">
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
  const dragSessionRef = useRef<{ pointerId: number; currentIndex: number; active: boolean; dragIntentConfirmed: boolean; startY: number; pointerY: number } | undefined>(undefined);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
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
    if (sourceIndex < 0 || destination < 0 || sourceIndex >= currentOptions.length || destination > currentOptions.length) return;
    if (sourceIndex === destination || sourceIndex === currentOptions.length - 1 && destination === currentOptions.length) return;
    const nextOptions = [...currentOptions];
    const nextColors = [...currentColors];
    const [movedOption] = nextOptions.splice(sourceIndex, 1);
    const [movedColor] = nextColors.splice(sourceIndex, 1);
    nextOptions.splice(destination, 0, movedOption);
    nextColors.splice(destination, 0, movedColor);
    onChangeRef.current(nextOptions, Object.fromEntries(nextOptions.map((option, index) => [option.trim(), nextColors[index]]).filter(([option, color]) => Boolean(option) && Boolean(color))));
    optionStateRef.current = { options: nextOptions, colors: nextColors };
    const nextIndex = sourceIndex < destination ? destination - 1 : destination;
    dragSessionRef.current!.currentIndex = nextIndex;
    setDraggingIndex(nextIndex);
    setDropIndex(nextIndex);
  };
  const optionAutoScroll = useDragEdgeAutoScroll({
    getContainer: () => optionListRef.current?.closest<HTMLElement>('.workspace-column-config-panel') ?? null,
    onScroll: () => {
      const session = dragSessionRef.current;
      if (!session) return;
      const items = Array.from(optionListRef.current?.querySelectorAll<HTMLElement>('[data-option-index]') ?? []);
      const destination = items.findIndex((item) => session.pointerY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
      reorderOption(session.currentIndex, destination === -1 ? items.length : destination);
    },
  });
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const distance = Math.abs(event.clientY - session.startY);
      if (!session.active && distance < 6) return;
      session.active = true;
      if (distance >= DRAG_SCROLL_INTENT_DISTANCE) session.dragIntentConfirmed = true;
      session.pointerY = event.clientY;
      const items = Array.from(optionListRef.current?.querySelectorAll<HTMLElement>('[data-option-index]') ?? []);
      const destination = items.findIndex((item) => event.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
      const insertion = destination === -1 ? items.length : destination;
      setDropIndex(insertion);
      reorderOption(session.currentIndex, insertion);
      optionAutoScroll.update({ x: event.clientX, y: event.clientY, axis: 'y' }, session.dragIntentConfirmed);
    };
    const end = (event: PointerEvent) => {
      if (dragSessionRef.current?.pointerId !== event.pointerId) return;
      optionAutoScroll.stop();
      dragSessionRef.current = undefined;
      setDraggingIndex(null);
      setDropIndex(null);
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
    dragSessionRef.current = { pointerId: event.pointerId, currentIndex: index, active: false, dragIntentConfirmed: false, startY: event.clientY, pointerY: event.clientY };
    setDraggingIndex(index);
    setDropIndex(index);
  };

  return <div ref={optionListRef} className="workspace-option-list">
    {visibleOptions.map((option, index) => <Fragment key={index}>
      {dropIndex === index && <div className="workspace-option-drop-indicator" role="status" aria-label={`放置在第 ${index + 1} 個選項前`} />}
      <div className={`workspace-option-row ${draggingIndex === index ? 'is-dragging' : ''}`} data-option-index={index}>
        <button type="button" className="workspace-option-drag-handle" aria-label={`拖曳固定選項 ${index + 1}`} aria-grabbed={draggingIndex === index} onPointerDown={(event) => beginOptionDrag(index, event)}><WorkspaceIcon name="more" size={20} /></button>
        <div className="workspace-option-editor"><AutoGrowTextarea value={option} aria-label={`固定選項 ${index + 1}`} placeholder={`選項 ${index + 1}`} onChange={(event) => updateOption(index, event.target.value)} /></div>
        <div className="workspace-option-controls">
          <WorkspaceColorPalette value={visibleColors[index]} onChange={(color) => updateOptionColor(index, color)} ariaLabel={`固定選項 ${index + 1} 顏色`} />
          <button type="button" className="workspace-option-remove" onClick={() => removeOption(index)} aria-label={`移除固定選項 ${index + 1}`}><WorkspaceIcon name="close" size={18} /></button>
        </div>
      </div>
    </Fragment>)}
    {dropIndex === visibleOptions.length && <div className="workspace-option-drop-indicator" role="status" aria-label="放置在最後一個選項後" />}
    {draggingIndex !== null && <div className="workspace-option-drag-status" role="status" aria-live="polite">拖曳中：第 {draggingIndex + 1} 個選項</div>}
    <button type="button" className="workspace-option-add" onClick={addOption}><WorkspaceIcon name="plus" size={18} />新增選項</button>
  </div>;
};
export const ColumnConfig = ({ column, suggestedOptions = [], onSave, onDelete }: { column: WorkspaceColumn; suggestedOptions?: string[]; onSave(column: WorkspaceColumn): void; onDelete?(): void }) => {
  const [draft, setDraft] = useState(column);
  const [activePanel, setActivePanel] = useState<'input' | 'overflow'>('input');
  const [lineLimitEnabled, setLineLimitEnabled] = useState(() => column.lineLimit !== undefined);
  const save = () => {
    const options = draft.options.map((option) => option.trim()).filter(Boolean);
    const optionColors = Object.fromEntries(Object.entries(draft.optionColors ?? {}).map(([option, color]) => [option.trim(), color]).filter(([option, color]) => Boolean(option) && isWorkspaceColor(color)));
    const widthLimitChars = typeof draft.widthLimitChars === 'number' && Number.isFinite(draft.widthLimitChars) && draft.widthLimitChars > 0 ? Math.max(1, Math.round(draft.widthLimitChars)) : undefined;
    const lineLimit = typeof draft.lineLimit === 'number' && Number.isFinite(draft.lineLimit) && draft.lineLimit > 0 ? Math.max(1, Math.round(draft.lineLimit)) : undefined;
    onSave({ ...draft, name: draft.name.trim(), options, optionColors, numberRanges: draft.numberRanges ?? [], numberInputMode: draft.inputType === 'number' ? getWorkspaceNumberInputMode(draft) : draft.numberInputMode, overflowMode: draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap'), widthLimitChars, lineLimit });
  };
  const category = inputCategoryFor(draft.inputType);
  const chooseInputCategory = (nextCategory: WorkspaceInputCategory) => {
    setActivePanel('input');
    setDraft((current) => {
      const currentCategory = inputCategoryFor(current.inputType);
      const nextType = currentCategory === nextCategory ? current.inputType : defaultInputTypeFor(nextCategory);
      return { ...current, inputType: nextType, overflowMode: nextType === 'link' && current.overflowMode === 'wrap' ? 'ellipsis' : current.overflowMode };
    });
  };
  const chooseInputSubtype = (inputType: WorkspaceInputType) => setDraft((current) => ({
    ...current,
    inputType,
    numberInputMode: inputType === 'number' && current.numberInputMode === undefined ? 'input' : current.numberInputMode,
    options: inputType === 'select' && current.options.length === 0 && suggestedOptions.length <= 10 ? suggestedOptions : current.options,
    overflowMode: inputType === 'link' && current.overflowMode === 'wrap' ? 'ellipsis' : current.overflowMode,
  }));
  const currentOverflowMode = draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap');
  return <WorkspaceModal title="屬性設定" dialogKind="editor" onClose={save} className="workspace-column-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除屬性"><WorkspaceIcon name="trash" size={20} /></button>}>
    <div className="workspace-column-config">
      <div className="workspace-column-config-rail">
        <label className="workspace-form-field">屬性名稱<AutoGrowTextarea value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <fieldset className="workspace-form-field workspace-input-type-field"><legend>輸入類型</legend><div className="workspace-input-type-options">{(Object.entries(inputCategoryLabels) as Array<[WorkspaceInputCategory, string]>).map(([value, label]) => <button type="button" key={value} className={category === value ? 'selected' : ''} onClick={() => chooseInputCategory(value)}>{label}</button>)}</div></fieldset>
        <fieldset className="workspace-form-field workspace-alignment-field"><legend>文字位置</legend><div className="workspace-alignment-options">{(['left', 'center', 'right'] as WorkspaceTextAlign[]).map((alignment) => <button type="button" key={alignment} className={(draft.alignment ?? 'left') === alignment ? 'selected' : ''} onClick={() => setDraft((current) => ({ ...current, alignment }))} aria-label={alignment === 'left' ? '置左' : alignment === 'center' ? '置中' : '置右'}><WorkspaceIcon name={alignment === 'left' ? 'align-left' : alignment === 'center' ? 'align-center' : 'align-right'} size={19} /></button>)}</div></fieldset>
        <div className="workspace-form-field workspace-overflow-field"><span>內容顯示</span><button type="button" className={activePanel === 'overflow' ? 'selected workspace-overflow-trigger' : 'workspace-overflow-trigger'} onClick={() => setActivePanel('overflow')}>{overflowModeLabels[currentOverflowMode]}<WorkspaceIcon name="chevron" size={17} /></button></div>
      </div>
      <div className="workspace-column-config-panel">
        {activePanel === 'input' ? <>
          <div className="workspace-input-subtype-options">
            <div>{inputSubtypeLabels[category].map(({ value, label }) => <button type="button" key={value} className={draft.inputType === value ? 'selected' : ''} onClick={() => chooseInputSubtype(value)}>{label}</button>)}</div>
            {(draft.inputType === 'select' || draft.inputType === 'dynamic-select') && <label className="workspace-multiple-toggle"><input type="checkbox" checked={Boolean(draft.isMultiple)} onChange={(event) => setDraft((current) => ({ ...current, isMultiple: event.target.checked }))} />多選</label>}
            {draft.inputType === 'datetime' && <label className="workspace-multiple-toggle"><input type="checkbox" checked={Boolean(draft.dateOnly)} onChange={(event) => setDraft((current) => ({ ...current, dateOnly: event.target.checked }))} />只顯示年月日</label>}
          </div>
          {draft.inputType === 'number' && <fieldset className="workspace-form-field workspace-number-input-mode-field"><legend>數字輸入方式</legend><div className="workspace-number-input-mode-options">{(Object.entries(numberInputModeLabels) as Array<[keyof typeof numberInputModeLabels, string]>).map(([mode, label]) => <button type="button" key={mode} className={getWorkspaceNumberInputMode(draft) === mode ? 'selected' : ''} onClick={() => setDraft((current) => ({ ...current, numberInputMode: mode }))}>{label}</button>)}</div></fieldset>}
          {draft.inputType === 'select' && <SelectionOptionsEditor options={draft.options} optionColors={draft.optionColors} onChange={(options, optionColors) => setDraft((current) => ({ ...current, options, optionColors }))} />}
          {draft.inputType === 'number' && <NumberRangeEditor ranges={draft.numberRanges ?? []} onChange={(numberRanges) => setDraft((current) => ({ ...current, numberRanges }))} />}
        </> : <div className="workspace-overflow-panel">
          <div className="workspace-overflow-options">{(Object.entries(overflowModeLabels) as Array<[WorkspaceOverflowMode, string]>).map(([mode, label]) => <button type="button" key={mode} className={currentOverflowMode === mode ? 'selected' : ''} onClick={() => setDraft((current) => ({ ...current, overflowMode: mode }))}>{label}</button>)}</div>
          {currentOverflowMode !== 'expand' && <label className="workspace-form-field">欄寬上限（全形字數）<input type="number" inputMode="numeric" min="1" step="1" value={draft.widthLimitChars ?? ''} placeholder="未設定" onChange={(event) => setDraft((current) => ({ ...current, widthLimitChars: event.target.value ? Number(event.target.value) : undefined }))} /></label>}
          {currentOverflowMode === 'wrap' && <>
            <label className="workspace-line-limit-toggle"><input type="checkbox" checked={lineLimitEnabled} onChange={(event) => { setLineLimitEnabled(event.target.checked); setDraft((current) => ({ ...current, lineLimit: event.target.checked ? current.lineLimit ?? 2 : undefined })); }} />行數上限（超過省略）</label>
            {lineLimitEnabled && <label className="workspace-form-field">最多顯示行數<input type="number" inputMode="numeric" min="1" max="20" step="1" value={draft.lineLimit ?? ''} aria-label="最多顯示行數" onChange={(event) => setDraft((current) => ({ ...current, lineLimit: event.target.value ? Number(event.target.value) : undefined }))} /></label>}
          </>}
        </div>}
          </div>
        </div>
  </WorkspaceModal>;
};
export interface CellInputDialogProps {
  column: WorkspaceColumn;
  value: WorkspaceCellValue;
  inputLabel?: string;
  onDelete?(): void;
  onDismiss?(): void;
  onSave(value: string): void;
  showConfirm?: boolean;
}
