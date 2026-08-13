import { useMemo, useState } from 'react';
import { distributeWorkspaceTotal } from './bulkEdit';
import type { WorkspaceColumn } from './types';
import { WorkspaceIcon, WorkspaceModal } from './workspaceShared';

export const WorkspaceBulkEditToolbar = ({ column, count, summary, hasDraft, onCancel, onOpenEditor, onOpenDistribution, onConfirm }: {
  column: WorkspaceColumn;
  count: number;
  summary: string;
  hasDraft: boolean;
  onCancel(): void;
  onOpenEditor(): void;
  onOpenDistribution(): void;
  onConfirm(): void;
}) => <div className="workspace-editbar workspace-bulk-toolbar" role="toolbar" aria-label={`批次編輯 ${column.name}`}>
  <div className="workspace-editbar-group">
    <button type="button" className="workspace-editbar-button" aria-label="結束批次選取" onClick={onCancel}><WorkspaceIcon name="close" size={21} /></button>
    <span className="workspace-bulk-count">已選 {count} 格</span>
  </div>
  <div className="workspace-bulk-actions">
    <button type="button" className="workspace-bulk-value" onClick={onOpenEditor} aria-label={`設定 ${column.name} 的批次內容`}><span className="workspace-bulk-property">{column.name || '未命名屬性'}</span><span className="workspace-bulk-summary">{hasDraft ? summary || '清除內容' : '設定內容'}</span></button>
    {column.inputType === 'number' && <button type="button" className="workspace-editbar-button" onClick={onOpenDistribution} aria-label="比例分配"><WorkspaceIcon name="ratio" size={22} /></button>}
    <button type="button" className="workspace-editbar-button workspace-bulk-confirm" aria-label="套用批次編輯" disabled={!hasDraft || count === 0} onClick={onConfirm}><WorkspaceIcon name="check" size={23} /></button>
  </div>
</div>;

export const WorkspaceRatioDistributionDialog = ({ rows, initialValues, onClose }: {
  rows: Array<{ rowId: string; label: string }>;
  initialValues?: Record<string, number>;
  onClose(values?: Record<string, number>): void;
}) => {
  const initialNumbers = rows.map((row) => initialValues?.[row.rowId]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const [total, setTotal] = useState(() => initialNumbers.length === rows.length ? String(initialNumbers.reduce((sum, value) => sum + value, 0)) : '');
  const [roundToIntegers, setRoundToIntegers] = useState(() => initialNumbers.length === 0 || initialNumbers.every(Number.isInteger));
  const [ratios, setRatios] = useState<Record<string, string>>(() => {
    const magnitudes = rows.map((row) => Math.abs(initialValues?.[row.rowId] ?? 0));
    const hasMagnitude = magnitudes.some((value) => value > 0);
    return Object.fromEntries(rows.map((row, index) => [row.rowId, String(hasMagnitude ? magnitudes[index] : 1)]));
  });
  const values = useMemo(() => distributeWorkspaceTotal(Number(total), rows.map((row) => ({ rowId: row.rowId, ratio: Number(ratios[row.rowId]) })), roundToIntegers), [ratios, roundToIntegers, rows, total]);
  const valid = total.trim() !== '' && values !== undefined;
  const finish = () => onClose(valid ? values : undefined);
  return <WorkspaceModal title="比例分配" onClose={finish} className="workspace-ratio-dialog">
    <form onSubmit={(event) => { event.preventDefault(); if (valid) finish(); }}>
    <label className="workspace-form-field">總和<input autoFocus type="number" inputMode="decimal" step="any" value={total} onChange={(event) => setTotal(event.target.value)} /></label>
    <label className="workspace-ratio-round"><input type="checkbox" checked={roundToIntegers} onChange={(event) => setRoundToIntegers(event.target.checked)} />四捨五入為整數</label>
    <div className="workspace-ratio-list">
      <div className="workspace-ratio-row workspace-ratio-heading" aria-hidden="true"><span>物件</span><span>比例</span><span>結果</span></div>
      {rows.map((row) => <div className="workspace-ratio-row" key={row.rowId}>
        <span title={row.label}>{row.label}</span>
        <label><span className="sr-only">{row.label}比例</span><input aria-label={`${row.label}比例`} type="number" inputMode="decimal" min="0" step="any" value={ratios[row.rowId]} onChange={(event) => setRatios((current) => ({ ...current, [row.rowId]: event.target.value }))} /></label>
        <output aria-label={`${row.label}分配結果`}>{valid ? values[row.rowId] : '—'}</output>
      </div>)}
    </div>
    </form>
  </WorkspaceModal>;
};
