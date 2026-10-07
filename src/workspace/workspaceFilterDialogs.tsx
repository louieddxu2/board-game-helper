import { useMemo, useState } from 'react';
import { dateFilterBoundary, dateFilterDaysInMonth, dateFilterParts, type DateFilterParts, type DateFilterPrecision } from './dateFilter';
import { WorkspaceInputType } from './types';
import { range, WheelPicker } from './workspaceCellDialogs';
import { HeaderFilterAggregate, HeaderFilterOption, HeaderFilterState, WorkspaceIcon, WorkspaceModal } from './workspaceShared';

const DateRangeFilterEditor = ({ state, onApply, onClear }: { state: HeaderFilterState; onApply(min: string, max: string, precision: DateFilterPrecision): void; onClear(): void }) => {
  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const [precision, setPrecision] = useState<DateFilterPrecision>(state.datePrecision ?? 'day');
  const [start, setStart] = useState<DateFilterParts>(() => dateFilterParts(state.min, today));
  const [end, setEnd] = useState<DateFilterParts>(() => dateFilterParts(state.max, today));
  const [startEnabled, setStartEnabled] = useState(() => Boolean(state.min) || !state.max);
  // An absent max has never been set; an empty max alongside a min is an explicit open end.
  const [endEnabled, setEndEnabled] = useState(() => state.max !== '' || !state.min);
  const [editingYear, setEditingYear] = useState<'start' | 'end' | null>(null);
  const [yearDraft, setYearDraft] = useState('');
  const hasRange = Boolean(state.min || state.max);
  const hasLegacyMonths = state.includedKeys !== null && !hasRange;
  const currentYear = now.getFullYear();
  const setPart = (endpoint: 'start' | 'end', key: keyof DateFilterParts, value: number) => {
    const setter = endpoint === 'start' ? setStart : setEnd;
    setter((current) => {
      const next = { ...current, [key]: value };
      next.day = Math.min(next.day, dateFilterDaysInMonth(next.year, next.month));
      return next;
    });
  };
  const commitYear = (endpoint: 'start' | 'end') => {
    const year = Number(yearDraft);
    setEditingYear(null);
    if (Number.isInteger(year) && year >= 1 && year <= 9999) setPart(endpoint, 'year', year);
  };
  const choosePrecision = (next: DateFilterPrecision) => {
    if (next === precision) return;
    if (precision === 'year' && next !== 'year') {
      setStart((current) => ({ ...current, month: 1, day: 1 }));
      setEnd((current) => ({ ...current, month: 12, day: 31 }));
    } else if (precision === 'month' && next === 'day') {
      setStart((current) => ({ ...current, day: 1 }));
      setEnd((current) => ({ ...current, day: dateFilterDaysInMonth(current.year, current.month) }));
    }
    setPrecision(next);
  };
  const clearRange = () => {
    setStart(today);
    setEnd(today);
    setStartEnabled(true);
    setEndEnabled(true);
    setPrecision('day');
    onClear();
  };
  const minimum = startEnabled ? dateFilterBoundary(start, precision, false) : '';
  const maximum = endEnabled ? dateFilterBoundary(end, precision, true) : '';
  const invalidRange = Boolean(minimum && maximum && minimum > maximum);
  const wheelRow = (endpoint: 'start' | 'end', parts: DateFilterParts, enabled: boolean) => <div className="workspace-datetime-wheel-row" role="group" aria-label={`${endpoint === 'start' ? '開始' : '結束'}日期`}>
    <WheelPicker label="年" value={parts.year} options={range(Math.max(1, Math.min(currentYear - 100, parts.year - 2)), Math.min(9999, Math.max(currentYear + 100, parts.year + 2)))} disabled={!enabled} onActivate={!enabled ? () => endpoint === 'start' ? setStartEnabled(true) : setEndEnabled(true) : undefined} onChange={(value) => setPart(endpoint, 'year', value)} onCenterClick={() => { setEditingYear(endpoint); setYearDraft(String(parts.year)); }} centerEditor={editingYear === endpoint ? <input autoFocus aria-label={`輸入${endpoint === 'start' ? '開始' : '結束'}年份`} className="workspace-datetime-year-input" type="number" inputMode="numeric" min="1" max="9999" value={yearDraft} onChange={(event) => setYearDraft(event.target.value)} onBlur={() => commitYear(endpoint)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitYear(endpoint); } if (event.key === 'Escape') { setEditingYear(null); } }} /> : undefined} />
    <WheelPicker label="月" value={parts.month} options={range(1, 12)} loop disabled={!enabled || precision === 'year'} onActivate={!enabled && precision !== 'year' ? () => endpoint === 'start' ? setStartEnabled(true) : setEndEnabled(true) : undefined} onChange={(value) => setPart(endpoint, 'month', value)} />
    <WheelPicker label="日" value={parts.day} options={range(1, dateFilterDaysInMonth(parts.year, parts.month))} loop disabled={!enabled || precision !== 'day'} onActivate={!enabled && precision === 'day' ? () => endpoint === 'start' ? setStartEnabled(true) : setEndEnabled(true) : undefined} onChange={(value) => setPart(endpoint, 'day', value)} />
  </div>;
  return <div className="workspace-date-filter-editor">
    <div className="workspace-date-filter-precision" role="group" aria-label="日期篩選精度">
      {(['year', 'month', 'day'] as const).map((item, index) => <button key={item} type="button" className={(['year', 'month', 'day'] as const).indexOf(precision) >= index ? 'is-filled' : ''} aria-pressed={precision === item} onClick={() => choosePrecision(item)}><span>{item === 'year' ? '年' : item === 'month' ? '月' : '日'}</span><span className="workspace-date-filter-precision-segment" aria-hidden="true" /></button>)}
    </div>
    <div className="workspace-date-filter-bound"><div className="workspace-date-filter-bound-heading"><h3>開始日期</h3>{startEnabled ? <button type="button" aria-label="開始日期不限" onClick={() => setStartEnabled(false)}>不限</button> : <span>滑動－以設定</span>}</div>{wheelRow('start', start, startEnabled)}</div>
    <div className="workspace-date-filter-bound"><div className="workspace-date-filter-bound-heading"><h3>結束日期</h3>{endEnabled ? <button type="button" aria-label="結束日期不限" onClick={() => setEndEnabled(false)}>不限</button> : <span>滑動－以設定</span>}</div>{wheelRow('end', end, endEnabled)}</div>
    {hasLegacyMonths && <p className="workspace-date-filter-note">先前選取的年月仍在篩選中；套用新範圍或清除後會取代它。</p>}
    {!hasRange && !hasLegacyMonths && <p className="workspace-date-filter-note">目前未設定日期範圍</p>}
    {invalidRange && <p className="workspace-date-filter-error" role="alert">結束日期須晚於開始日期</p>}
    <div className="workspace-date-filter-actions"><button type="button" onClick={clearRange}>清除範圍</button><button type="button" className="primary" disabled={invalidRange} onClick={() => onApply(minimum, maximum, precision)}>套用範圍</button></div>
  </div>;
};

export const HeaderFilterDialog = ({ label, inputType, options, numericValues, state, onClose, onSort, onToggle, onSelectAll, onClearAll, onQuery, onRange, onDateRange, onClearDate, onAggregate }: { label: string; inputType?: WorkspaceInputType; options: HeaderFilterOption[]; numericValues: number[]; state: HeaderFilterState; onClose(): void; onSort(direction: 'asc' | 'desc'): void; onToggle(key: string): void; onSelectAll(): void; onClearAll(): void; onQuery(query: string): void; onRange(min: string, max: string): void; onDateRange(min: string, max: string, precision: DateFilterPrecision): void; onClearDate(): void; onAggregate(aggregate: HeaderFilterAggregate): void }) => {
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
  return <WorkspaceModal owner="filter" title={`篩選 ${label}`} onRequestClose={onClose} className={`workspace-filter-dialog${isDate ? ' workspace-date-filter-dialog' : ''}`}>
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
    {isDate && <DateRangeFilterEditor state={state} onApply={onDateRange} onClear={onClearDate} />}
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
