import { Fragment, useEffect, useRef, useState } from 'react';
import { getWorkspaceNumberInputMode, isWorkspaceColor } from './model';
import { WorkspaceColumn, WorkspaceInputType, WorkspaceNumberRange, WorkspaceOverflowMode, WorkspaceTextAlign } from './types';
import { DRAG_SCROLL_INTENT_DISTANCE, useDragEdgeAutoScroll } from './useDragEdgeAutoScroll';
import { AutoGrowTextarea, defaultInputTypeFor, inputCategoryFor, inputCategoryLabels, inputSubtypeLabels, numberInputModeLabels, overflowModeLabels, workspaceColorPalette, WorkspaceIcon, WorkspaceInputCategory, WorkspaceModal } from './workspaceShared';

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

export const ColumnConfig = ({ column, suggestedOptions = [], onSave, onDelete }: { column: WorkspaceColumn; suggestedOptions?: string[]; onSave(column: WorkspaceColumn): string | void; onDelete?(): void }) => {
  const [draft, setDraft] = useState(column);
  const [error, setError] = useState('');
  const [activePanel, setActivePanel] = useState<'input' | 'overflow'>('input');
  const [lineLimitEnabled, setLineLimitEnabled] = useState(() => column.lineLimit !== undefined);
  const save = () => {
    const options = draft.options.map((option) => option.trim()).filter(Boolean);
    const optionColors = Object.fromEntries(Object.entries(draft.optionColors ?? {}).map(([option, color]) => [option.trim(), color]).filter(([option, color]) => Boolean(option) && isWorkspaceColor(color)));
    const widthLimitChars = typeof draft.widthLimitChars === 'number' && Number.isFinite(draft.widthLimitChars) && draft.widthLimitChars > 0 ? Math.max(1, Math.round(draft.widthLimitChars)) : undefined;
    const lineLimit = typeof draft.lineLimit === 'number' && Number.isFinite(draft.lineLimit) && draft.lineLimit > 0 ? Math.max(1, Math.round(draft.lineLimit)) : undefined;
    const failure = onSave({ ...draft, name: draft.name.trim(), options, optionColors, numberRanges: draft.numberRanges ?? [], numberInputMode: draft.inputType === 'number' ? getWorkspaceNumberInputMode(draft) : draft.numberInputMode, overflowMode: draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap'), widthLimitChars, lineLimit });
    setError(failure ?? '');
  };
  const category = inputCategoryFor(draft.inputType);
  const chooseInputCategory = (nextCategory: WorkspaceInputCategory) => {
    setError('');
    setActivePanel('input');
    setDraft((current) => {
      const currentCategory = inputCategoryFor(current.inputType);
      const nextType = currentCategory === nextCategory ? current.inputType : defaultInputTypeFor(nextCategory);
      return { ...current, inputType: nextType, overflowMode: nextType === 'link' && current.overflowMode === 'wrap' ? 'ellipsis' : current.overflowMode };
    });
  };
  const chooseInputSubtype = (inputType: WorkspaceInputType) => {
    setError('');
    setDraft(current => ({
      ...current,
      inputType,
      numberInputMode: inputType === 'number' && current.numberInputMode === undefined ? 'input' : current.numberInputMode,
      options: inputType === 'select' && current.options.length === 0 && suggestedOptions.length <= 10 ? suggestedOptions : current.options,
      overflowMode: inputType === 'link' && current.overflowMode === 'wrap' ? 'ellipsis' : current.overflowMode,
    }));
  };
  const currentOverflowMode = draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap');
  return <WorkspaceModal owner="column-config" title="屬性設定" dialogKind="editor" initialFocus="dialog" onRequestClose={save} className="workspace-column-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除屬性"><WorkspaceIcon name="trash" size={20} /></button>}>
    <div className="workspace-column-config">
      <div className="workspace-column-config-rail">
        <label className="workspace-form-field">屬性名稱<AutoGrowTextarea value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <fieldset className="workspace-form-field workspace-input-type-field"><legend>輸入類型</legend><div className="workspace-input-type-options">{(Object.entries(inputCategoryLabels) as Array<[WorkspaceInputCategory, string]>).map(([value, label]) => <button type="button" key={value} className={category === value ? 'selected' : ''} aria-pressed={category === value} onClick={() => chooseInputCategory(value)}>{label}</button>)}</div></fieldset>
        <fieldset className="workspace-form-field workspace-alignment-field"><legend>文字位置</legend><div className="workspace-alignment-options">{(['left', 'center', 'right'] as WorkspaceTextAlign[]).map((alignment) => <button type="button" key={alignment} className={(draft.alignment ?? 'left') === alignment ? 'selected' : ''} aria-pressed={(draft.alignment ?? 'left') === alignment} onClick={() => setDraft((current) => ({ ...current, alignment }))} aria-label={alignment === 'left' ? '置左' : alignment === 'center' ? '置中' : '置右'}><WorkspaceIcon name={alignment === 'left' ? 'align-left' : alignment === 'center' ? 'align-center' : 'align-right'} size={19} /></button>)}</div></fieldset>
        <div className="workspace-form-field workspace-overflow-field"><span>內容顯示</span><button type="button" className={activePanel === 'overflow' ? 'selected workspace-overflow-trigger' : 'workspace-overflow-trigger'} aria-pressed={activePanel === 'overflow'} onClick={() => setActivePanel('overflow')}>{overflowModeLabels[currentOverflowMode]}<WorkspaceIcon name="chevron" size={17} /></button></div>
      </div>
      <div className="workspace-column-config-panel">
        {error && <p className="form-error" role="alert">{error}</p>}
        {activePanel === 'input' ? <>
          <div className="workspace-input-subtype-options">
            <div>{inputSubtypeLabels[category].map(({ value, label }) => <button type="button" key={value} className={draft.inputType === value ? 'selected' : ''} aria-pressed={draft.inputType === value} onClick={() => chooseInputSubtype(value)}>{label}</button>)}</div>
            {(draft.inputType === 'select' || draft.inputType === 'dynamic-select') && <label className="workspace-multiple-toggle"><input type="checkbox" checked={Boolean(draft.isMultiple)} onChange={(event) => setDraft((current) => ({ ...current, isMultiple: event.target.checked }))} />多選</label>}
            {draft.inputType === 'datetime' && <label className="workspace-multiple-toggle"><input type="checkbox" checked={Boolean(draft.dateOnly)} onChange={(event) => setDraft((current) => ({ ...current, dateOnly: event.target.checked }))} />只顯示年月日</label>}
          </div>
          {draft.inputType === 'number' && <fieldset className="workspace-form-field workspace-number-input-mode-field"><legend>數字輸入方式</legend><div className="workspace-number-input-mode-options">{(Object.entries(numberInputModeLabels) as Array<[keyof typeof numberInputModeLabels, string]>).map(([mode, label]) => <button type="button" key={mode} className={getWorkspaceNumberInputMode(draft) === mode ? 'selected' : ''} aria-pressed={getWorkspaceNumberInputMode(draft) === mode} onClick={() => setDraft((current) => ({ ...current, numberInputMode: mode }))}>{label}</button>)}</div></fieldset>}
          {draft.inputType === 'select' && <SelectionOptionsEditor options={draft.options} optionColors={draft.optionColors} onChange={(options, optionColors) => setDraft((current) => ({ ...current, options, optionColors }))} />}
          {draft.inputType === 'number' && <NumberRangeEditor ranges={draft.numberRanges ?? []} onChange={(numberRanges) => setDraft((current) => ({ ...current, numberRanges }))} />}
        </> : <div className="workspace-overflow-panel">
          <div className="workspace-overflow-options">{(Object.entries(overflowModeLabels) as Array<[WorkspaceOverflowMode, string]>).map(([mode, label]) => <button type="button" key={mode} className={currentOverflowMode === mode ? 'selected' : ''} aria-pressed={currentOverflowMode === mode} onClick={() => setDraft((current) => ({ ...current, overflowMode: mode }))}>{label}</button>)}</div>
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
