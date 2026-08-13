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
    <button type="button" className="workspace-bulk-value" onClick={onOpenEditor} aria-label={`設定 ${column.name} 的批次內容`}><span>{hasDraft ? summary || '清除內容' : '設定內容'}</span></button>
    {column.inputType === 'number' && <button type="button" className="workspace-editbar-button" onClick={onOpenDistribution} aria-label="比例分配"><WorkspaceIcon name="ratio" size={22} /></button>}
    <button type="button" className="workspace-editbar-button workspace-bulk-confirm" aria-label="套用批次編輯" disabled={!hasDraft || count === 0} onClick={onConfirm}><WorkspaceIcon name="check" size={23} /></button>
  </div>
</div>;

export const WorkspaceRatioDistributionDialog = ({ rows, onClose, onApply }: {
  rows: Array<{ rowId: string; label: string }>;
  onClose(): void;
  onApply(values: Record<string, number>): void;
}) => {
  const [total, setTotal] = useState('');
  const [roundToIntegers, setRoundToIntegers] = useState(true);
  const [ratios, setRatios] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((row) => [row.rowId, '1'])));
  const values = useMemo(() => distributeWorkspaceTotal(Number(total), rows.map((row) => ({ rowId: row.rowId, ratio: Number(ratios[row.rowId]) })), roundToIntegers), [ratios, roundToIntegers, rows, total]);
  const valid = total.trim() !== '' && values !== undefined;
  return <WorkspaceModal title="比例分配" onClose={onClose} className="workspace-ratio-dialog" actions={<button type="button" className="workspace-dialog-button primary" disabled={!valid} onClick={() => values && onApply(values)}>套用預覽</button>}>
    <label className="workspace-form-field">總和<input autoFocus type="number" inputMode="decimal" step="any" value={total} onChange={(event) => setTotal(event.target.value)} /></label>
    <label className="workspace-ratio-round"><input type="checkbox" checked={roundToIntegers} onChange={(event) => setRoundToIntegers(event.target.checked)} />四捨五入為整數</label>
    <div className="workspace-ratio-list">
      {rows.map((row) => <div className="workspace-ratio-row" key={row.rowId}>
        <span title={row.label}>{row.label}</span>
        <label><span className="sr-only">{row.label}比例</span><input aria-label={`${row.label}比例`} type="number" inputMode="decimal" min="0" step="any" value={ratios[row.rowId]} onChange={(event) => setRatios((current) => ({ ...current, [row.rowId]: event.target.value }))} /></label>
        <output aria-label={`${row.label}分配結果`}>{valid ? values[row.rowId] : '—'}</output>
      </div>)}
    </div>
  </WorkspaceModal>;
};
