import { useMemo, useState } from 'react';
import { distributeWorkspaceTotal } from './bulkEdit';
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
    <button type="button" className="workspace-bulk-value" onClick={onOpenEditor} aria-label={`開啟 ${column.name} 批次輸入`}><span className="workspace-bulk-property">{column.name || '未命名屬性'}</span><span className="workspace-bulk-summary">批次輸入</span></button>
  </div>
</div>;

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
