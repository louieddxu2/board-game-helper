import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { displayWorkspaceCellValue, getWorkspaceNumberInputMode, isWorkspaceLinkValue, normalizeWorkspaceDateTime, workspaceDateTimeFromParts, workspaceDateTimeParts } from './model';
import { WorkspaceCellValue, WorkspaceColumn, WorkspaceLinkValue } from './types';
import type { WorkspaceModalOwner } from './workspaceModalClose';
import { AutoGrowTextarea, WorkspaceIcon, WorkspaceModal } from './workspaceShared';
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
  return <span className={`workspace-number-aligned-value ${parts.fraction ? 'has-fraction' : 'is-integer'}`} aria-label={value}>
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
    <div className="workspace-number-editor" data-mode={mode} data-has-adjustment-controls={adjustmentEnabled ? 'true' : 'false'} style={{ '--workspace-number-fraction-width': `${fractionDigits}ch` } as React.CSSProperties}>
    {mode !== 'direct' && <button type="button" className="workspace-number-original" aria-label={`編輯原始數值 ${originalDraft || '空白'}`} onPointerDown={(event) => event.preventDefault()} onClick={restoreOriginal}><NumericAlignedValue value={originalDraft} /></button>}
    <div className="workspace-number-input-shell">
      <input ref={inputRef} aria-label={mode === 'direct' ? baseLabel : `${baseLabel}${mode === 'add' ? '加法' : '減法'}`} autoFocus className="workspace-value-input" type="number" inputMode="decimal" enterKeyHint="done" step="any" min={mode === 'direct' ? undefined : 0} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
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
    <div className="workspace-number-editor" data-mode="step" data-has-adjustment-controls="true" style={{ '--workspace-number-fraction-width': `${fractionDigits}ch` } as React.CSSProperties}>
      <button type="button" className="workspace-number-operation workspace-number-operation-subtract" aria-label="減少 1" onPointerDown={(event) => event.preventDefault()} onClick={() => step(-1)}>−</button>
      <div className="workspace-number-input-shell">
        <input ref={inputRef} autoFocus aria-label={baseLabel} className="workspace-value-input" style={{ textAlign: 'center' }} type="number" inputMode="decimal" enterKeyHint="done" step="any" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
      </div>
      <button type="button" className="workspace-number-operation workspace-number-operation-add" aria-label="增加 1" onPointerDown={(event) => event.preventDefault()} onClick={() => step(1)}>＋</button>
    </div>
  </div>;
});

NumericStepEditor.displayName = 'NumericStepEditor';

export const CellInputDialog = ({ owner = 'cell-editor', column, value, inputLabel, onDelete, onDismiss, onSave, showConfirm = false }: CellInputDialogProps) => {
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
  return <WorkspaceModal owner={owner} title={column.name} dialogKind="editor" onRequestClose={dismiss} className={`workspace-value-dialog ${column.inputType === 'number' ? 'workspace-number-value-dialog' : ''}${column.inputType === 'datetime' ? ' workspace-datetime-dialog' : ''}`} leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>} actions={showConfirm ? <button type="button" className="workspace-dialog-button primary" onClick={close}>確認</button> : undefined}>
    {column.inputType === 'datetime'
      ? <DateTimeWheelEditor value={draft} ariaLabel={inputLabel ?? `${column.name}${column.dateOnly ? '日期' : '日期時間'}`} showTime={!column.dateOnly} onChange={(next) => { setDraft(next); setDateDirty(true); }} onCurrent={(next) => { if (showConfirm) { setDraft(next); setDateDirty(true); } else onSave(next); }} onClear={() => { if (showConfirm) { setDraft(''); setDateDirty(true); } else onSave(''); }} />
      : column.inputType === 'number'
      ? getWorkspaceNumberInputMode(column) === 'step'
        ? <NumericStepEditor ref={numericEditorRef} column={column} value={value} inputLabel={inputLabel} onSave={onSave} />
        : <NumericCellEditor ref={numericEditorRef} column={column} value={value} inputLabel={inputLabel} onDismiss={onDismiss} onSave={onSave} />
      : <AutoGrowTextarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input workspace-value-textarea" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); } }} />}
  </WorkspaceModal>;
};

export const range = (start: number, end: number) => Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);

export const WheelPicker = ({ label, value, options, onChange, loop = false, centerEditor, onCenterClick, disabled = false, onActivate }: { label: string; value: number; options: number[]; onChange(value: number): void; loop?: boolean; centerEditor?: React.ReactNode; onCenterClick?(): void; disabled?: boolean; onActivate?(): void }) => {
  const dragRef = useRef<{ pointerId: number; startY: number; lastStep: number; moved: boolean } | undefined>(undefined);
  const valueRef = useRef(value);
  const suppressClickRef = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const canActivate = disabled && Boolean(onActivate);
  useLayoutEffect(() => { valueRef.current = value; }, [value]);
  const index = Math.max(0, options.indexOf(value));
  const valueAt = (offset: number) => {
    if (disabled) return undefined;
    if (!options.length) return undefined;
    let nextIndex = index + offset;
    if (loop) nextIndex = (nextIndex % options.length + options.length) % options.length;
    if (nextIndex < 0 || nextIndex >= options.length) return undefined;
    return options[nextIndex];
  };
  const moveBy = (delta: number) => {
    if (disabled || !options.length || !delta) return;
    const nextIndex = Math.max(0, options.indexOf(valueRef.current)) + delta;
    let nextValue: number | undefined;
    if (loop) {
      nextValue = options[(nextIndex % options.length + options.length) % options.length];
    } else if (nextIndex >= 0 && nextIndex < options.length) {
      nextValue = options[nextIndex];
    }
    if (nextValue !== undefined && nextValue !== valueRef.current) {
      valueRef.current = nextValue;
      onChange(nextValue);
    }
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = undefined;
    setDragging(false);
    setDragOffset(0);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className={`workspace-datetime-wheel${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}${canActivate ? ' is-activatable' : ''}`} role={canActivate ? 'button' : disabled ? 'group' : 'listbox'} aria-label={canActivate ? `${label}未設定，滑動以設定` : disabled ? `${label}未啟用` : label} aria-disabled={disabled && !canActivate || undefined} tabIndex={disabled && !canActivate ? -1 : 0}
    onWheel={(event) => { if (disabled) { if (canActivate) { event.preventDefault(); onActivate?.(); } return; } event.preventDefault(); moveBy(event.deltaY > 0 ? 1 : -1); }}
    onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || canActivate && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (canActivate) onActivate?.(); else moveBy(event.key === 'ArrowDown' ? 1 : -1); } }}
    onPointerDown={(event) => { if (disabled && !canActivate || event.button !== 0 || (event.target as HTMLElement).closest('input')) return; suppressClickRef.current = false; dragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastStep: 0, moved: false }; setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); }}
    onPointerMove={(event) => { const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return; const delta = drag.startY - event.clientY; if (canActivate) { setDragOffset(-Math.max(-12, Math.min(12, delta))); if (Math.abs(delta) >= 12) { drag.moved = true; drag.startY = event.clientY; drag.lastStep = 0; setDragOffset(0); onActivate?.(); } return; } if (Math.abs(delta) > 4) drag.moved = true; const step = Math.trunc(delta / 32); if (step !== drag.lastStep) { moveBy(step - drag.lastStep); drag.lastStep = step; } setDragOffset(-(delta - step * 32)); }}
    onPointerUp={endDrag} onPointerCancel={endDrag}
    onClickCapture={(event) => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false; } }}
    onClick={() => { if (canActivate) onActivate?.(); }}>
    <div className="workspace-datetime-wheel-window"><div className="workspace-datetime-wheel-track" style={{ '--workspace-wheel-offset': `${dragOffset}px` } as React.CSSProperties}>
    {[-2, -1, 0, 1, 2].map((offset) => {
      if (disabled) return offset === 0 ? <span className="workspace-datetime-wheel-disabled-value" key={offset}>－</span> : <span className="workspace-datetime-wheel-empty" aria-hidden="true" key={offset} />;
      const option = valueAt(offset);
      if (offset === 0 && centerEditor) return <span className="workspace-datetime-wheel-center-editor" key="center-editor">{centerEditor}</span>;
      return option === undefined
        ? <span className="workspace-datetime-wheel-empty" aria-hidden="true" key={offset} />
        : <button type="button" role="option" aria-selected={offset === 0} className={offset === 0 ? 'selected' : ''} key={offset} onClick={() => offset === 0 && onCenterClick ? onCenterClick() : onChange(option)}>{String(option)}</button>;
    })}
    </div></div>
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
      <WheelPicker label="年" value={parts.year} options={range(Math.max(1, Math.min(currentYear - 100, parts.year - 2)), Math.min(9999, Math.max(currentYear + 100, parts.year + 2)))} onChange={(next) => updatePart('year', next)} onCenterClick={() => { setYearDraft(String(parts.year)); setEditingYear(true); }} centerEditor={editingYear ? <input autoFocus aria-label="輸入年份" className="workspace-datetime-year-input" type="number" inputMode="numeric" min="1" max="9999" value={yearDraft} onChange={(event) => setYearDraft(event.target.value)} onBlur={commitYear} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitYear(); } if (event.key === 'Escape') { setYearDraft(String(parts.year)); setEditingYear(false); } }} /> : undefined} />
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

export const LinkInputDialog = ({ owner = 'cell-editor', column, value, onDelete, onSave, onDismiss, showConfirm = false }: { owner?: WorkspaceModalOwner; column: WorkspaceColumn; value: WorkspaceCellValue; onDelete?(): void; onSave(value: WorkspaceLinkValue | null): void; onDismiss?(): void; showConfirm?: boolean }) => {
  const initial = isWorkspaceLinkValue(value) ? value : { url: typeof value === 'string' ? value : '', label: '' };
  const [url, setUrl] = useState(initial.url);
  const [label, setLabel] = useState(initial.label);
  const commit = () => onSave(url.trim() || label.trim() ? { url: url.trim(), label: label.trim() } : null);
  const dismiss = showConfirm ? (onDismiss ?? (() => undefined)) : commit;
  return <WorkspaceModal owner={owner} title={column.name} dialogKind="editor" onRequestClose={dismiss} className="workspace-link-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>} actions={showConfirm ? <button type="button" className="workspace-dialog-button primary" onClick={commit}>確認</button> : undefined}>
    <div className="workspace-link-fields">
      <label className="workspace-form-field">連結<input autoFocus type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <label className="workspace-form-field">顯示名稱<input type="text" inputMode="text" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
    </div>
  </WorkspaceModal>;
};

export interface CellInputDialogProps {
  owner?: WorkspaceModalOwner;
  column: WorkspaceColumn;
  value: WorkspaceCellValue;
  inputLabel?: string;
  onDelete?(): void;
  onDismiss?(): void;
  onSave(value: string): void;
  showConfirm?: boolean;
}
