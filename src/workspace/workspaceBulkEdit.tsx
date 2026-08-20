import { useMemo, useState } from 'react';
import { distributeWorkspaceTotal, summarizeWorkspaceMultiSelectOptions, type WorkspaceMultiSelectBatchIntent, type WorkspaceMultiSelectBatchRow, type WorkspaceMultiSelectOptionSummary } from './bulkEdit';
import type { WorkspaceColumn } from './types';
import { WorkspaceIcon, WorkspaceModal } from './workspaceShared';

export const WorkspaceBulkEditToolbar = ({ column, count, onCancel, onOpenEditor }: {
  column: WorkspaceColumn;
  count: number;
  onCancel(): void;
  onOpenEditor(): void;
}) => <div className="workspace-editbar workspace-bulk-toolbar" role="toolbar" aria-label={`批次編輯 ${column.name}`}>
  <div className="workspace-editbar-group">
    <button type="button" className="workspace-editbar-button" aria-label="結束批次選取" onClick={onCancel}><WorkspaceIcon name="close" size={21} /></button>
    <span className="workspace-bulk-count">已選 {count} 格</span>
  </div>
  <div className="workspace-bulk-actions">
    <button type="button" className="workspace-bulk-value" onClick={onOpenEditor} aria-label={`開啟 ${column.name} 批次輸入`}><WorkspaceIcon name="edit" size={16} /><span className="workspace-bulk-property">{column.name || '未命名屬性'}</span><span className="workspace-bulk-summary">批次輸入</span></button>
  </div>
</div>;

export const WorkspaceBulkMultiSelectDialog = ({ column, rows, options, onClose, onConfirm }: {
  column: WorkspaceColumn;
  rows: WorkspaceMultiSelectBatchRow[];
  options: string[];
  onClose(): void;
  onConfirm(intents: WorkspaceMultiSelectBatchIntent[]): void;
}) => {
  const [query, setQuery] = useState('');
  const [addedOptions, setAddedOptions] = useState<string[]>([]);
  const [intents, setIntents] = useState<WorkspaceMultiSelectBatchIntent[]>([]);
  const isDynamic = column.inputType === 'dynamic-select';
  const summaries = useMemo(() => summarizeWorkspaceMultiSelectOptions(rows, [...options, ...addedOptions]), [addedOptions, options, rows]);
  const normalizedQuery = query.trim();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return summaries;
    const normalized = normalizedQuery.toLocaleLowerCase();
    return summaries.filter(({ option }) => option.toLocaleLowerCase().includes(normalized));
  }, [normalizedQuery, summaries]);
  const intentsByOption = useMemo(() => new Map(intents.map((intent) => [intent.option, intent.action])), [intents]);
  const allRemoveIntents = useMemo(() => summaries.filter(({ count }) => count > 0).map(({ option }) => ({ option, action: 'remove' as const })), [summaries]);
  const allRemoveActive = allRemoveIntents.length > 0
    && intents.length === allRemoveIntents.length
    && allRemoveIntents.every((intent) => intentsByOption.get(intent.option) === 'remove');

  const setOptionAction = (summary: WorkspaceMultiSelectOptionSummary, action: WorkspaceMultiSelectBatchIntent['action']) => {
    setIntents((current) => {
      const existing = current.find((intent) => intent.option === summary.option);
      const withoutOption = current.filter((intent) => intent.option !== summary.option);
      const alreadySatisfied = action === 'add' ? summary.count === summary.total : summary.count === 0;
      if (existing?.action === action || alreadySatisfied) return withoutOption;
      return [...withoutOption, { option: summary.option, action }];
    });
  };

  const addDynamicOption = () => {
    if (!isDynamic || !normalizedQuery) return;
    const existing = summaries.find(({ option }) => option.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());
    if (existing) setOptionAction(existing, 'add');
    else {
      setAddedOptions((current) => [...current, normalizedQuery]);
      setIntents((current) => [...current, { option: normalizedQuery, action: 'add' }]);
    }
    setQuery('');
  };

  return <WorkspaceModal title={column.name} dialogKind="editor" onClose={onClose} className="workspace-selection-dialog workspace-bulk-multi-dialog" actions={<div className="workspace-bulk-multi-actions">
    <button type="button" className={`workspace-selection-tool is-clear ${allRemoveActive ? 'is-active' : ''}`} aria-pressed={allRemoveActive} onClick={() => setIntents(allRemoveActive ? [] : allRemoveIntents)}><WorkspaceIcon name="close" size={15} />全部移除</button>
    <button type="button" className="workspace-dialog-button primary" disabled={!intents.length} onClick={() => onConfirm(intents)}>確認</button>
  </div>}>
    {isDynamic && <div className="workspace-selection-head">
      <label className="workspace-selection-search"><WorkspaceIcon name="search" size={19} /><span className="sr-only">搜尋或新增選項</span><input inputMode="text" enterKeyHint="done" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDynamicOption(); } }} placeholder="搜尋或輸入…" /><button type="button" onClick={() => setQuery('')} aria-label="清除搜尋" disabled={!query}><WorkspaceIcon name="close" size={17} /></button></label>
    </div>}
    <div className="workspace-bulk-multi-list" role="list" aria-label={`${column.name}批次選項`}>
      {filtered.map((summary) => {
        const action = intentsByOption.get(summary.option);
        const displayedCount = action === 'add' ? summary.total : action === 'remove' ? 0 : summary.count;
        return <div className={`workspace-bulk-multi-row ${action ? `is-${action}` : ''}`} role="listitem" key={summary.option}>
          <button type="button" className="workspace-bulk-multi-remove" aria-label={action === 'remove' ? `取消移除 ${summary.option}` : `從全部格子移除 ${summary.option}`} aria-pressed={action === 'remove'} onClick={() => setOptionAction(summary, 'remove')}><WorkspaceIcon name="close" size={17} /></button>
          <button type="button" className="workspace-bulk-multi-option" aria-label={action === 'add' ? `取消寫入 ${summary.option}` : `寫入 ${summary.option} 至全部格子`} aria-pressed={action === 'add'} onClick={() => setOptionAction(summary, 'add')}>
            <span className="workspace-bulk-multi-label">{summary.option}</span>
            <span className="workspace-bulk-multi-count"><strong>{displayedCount}</strong><span>/{summary.total}</span></span>
          </button>
        </div>;
      })}
      {!filtered.length && <p className="workspace-selection-empty">{isDynamic && normalizedQuery ? '按 Enter 新增這個選項' : '目前沒有可選項目'}</p>}
    </div>
  </WorkspaceModal>;
};

export interface WorkspaceRatioDistributionResult {
  total: number | null;
  values?: Record<string, number>;
}

export const WorkspaceBulkNumberDialog = ({ column, rows, initialValues, initialTotal, onClose, onConfirm }: {
  column: WorkspaceColumn;
  rows: Array<{ rowId: string; label: string }>;
  initialValues?: Record<string, number>;
  initialTotal?: number | null;
  onClose(): void;
  onConfirm(result?: WorkspaceRatioDistributionResult): void;
}) => {
  const initialNumbers = rows.map((row) => initialValues?.[row.rowId]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const [total, setTotal] = useState(() => typeof initialTotal === 'number' && Number.isFinite(initialTotal)
    ? String(initialTotal)
    : initialNumbers.length === rows.length ? String(initialNumbers.reduce((sum, value) => sum + value, 0)) : '');
  const [roundToIntegers, setRoundToIntegers] = useState(() => initialNumbers.length === 0 || initialNumbers.every(Number.isInteger));
  const [expanded, setExpanded] = useState(() => initialValues !== undefined);
  const [ratios, setRatios] = useState<Record<string, string>>(() => {
    const magnitudes = rows.map((row) => Math.abs(initialValues?.[row.rowId] ?? 0));
    const hasMagnitude = magnitudes.some((value) => value > 0);
    return Object.fromEntries(rows.map((row, index) => [row.rowId, String(hasMagnitude ? magnitudes[index] : 1)]));
  });
  const values = useMemo(() => distributeWorkspaceTotal(Number(total), rows.map((row) => ({ rowId: row.rowId, ratio: Number(ratios[row.rowId]) })), roundToIntegers), [ratios, roundToIntegers, rows, total]);
  const finish = () => {
    if (!total.trim()) {
      onConfirm({ total: null });
      return;
    }
    const numericTotal = Number(total);
    if (!Number.isFinite(numericTotal)) {
      onConfirm(undefined);
      return;
    }
    onConfirm({ total: numericTotal, values: expanded ? values : undefined });
  };
  const validDistribution = total.trim() !== '' && values !== undefined;
  return <WorkspaceModal title={column.name} dialogKind="editor" onClose={onClose} className={`workspace-value-dialog workspace-bulk-number-dialog ${expanded ? 'is-expanded' : ''}`} actions={<button type="button" className="workspace-dialog-button primary" onClick={finish}>確認</button>}>
    <form className="workspace-bulk-number-form" onSubmit={(event) => { event.preventDefault(); finish(); }}>
      <input autoFocus aria-label={`${column.name}批次輸入`} className="workspace-value-input" type="number" inputMode="decimal" enterKeyHint="done" step="any" value={total} onChange={(event) => setTotal(event.target.value)} />
      <button type="button" className="workspace-ratio-disclosure" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><WorkspaceIcon name="chevron" size={16} />比例分配</button>
      {expanded && <div className="workspace-ratio-panel">
        <label className="workspace-ratio-round"><input className="workspace-compact-checkbox" type="checkbox" checked={roundToIntegers} onChange={(event) => setRoundToIntegers(event.target.checked)} />近似取整</label>
        <div className="workspace-ratio-list">
          <div className="workspace-ratio-row workspace-ratio-heading" aria-hidden="true"><span>物件</span><span>比例</span><span>→</span></div>
          {rows.map((row) => <div className="workspace-ratio-row" key={row.rowId}>
            <span className="workspace-ratio-name" title={row.label}>{row.label}</span>
            <label className="workspace-ratio-input"><span className="workspace-ratio-field-label">比例</span><input aria-label={`${row.label}比例`} type="number" inputMode="decimal" min="0" step="any" value={ratios[row.rowId]} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => setRatios((current) => ({ ...current, [row.rowId]: event.target.value }))} /></label>
            <span className="workspace-ratio-result"><span className="workspace-ratio-field-label" aria-hidden="true">→</span><output aria-label={`${row.label}分配結果`}>{validDistribution ? values[row.rowId] : '—'}</output></span>
          </div>)}
        </div>
      </div>}
    </form>
  </WorkspaceModal>;
};
