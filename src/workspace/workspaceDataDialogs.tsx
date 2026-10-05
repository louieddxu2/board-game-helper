import { useMemo, useState } from 'react';
import { getRowHeaderColumn } from './model';
import { prepareWorkspaceColumnSave, WorkspaceColumnConversionError } from './columnConversion';
import type { WorkspaceInputType, WorkspaceTable } from './types';
import type { WorkspaceImportSource } from './spreadsheet';
import { parseWorkspaceClipboard } from './workspacePaste';
import { WorkspaceIcon, WorkspaceModal } from './workspaceShared';

const inputTypes: Array<{ value: WorkspaceInputType; label: string }> = [
  { value: 'text', label: '文字' },
  { value: 'number', label: '數字' },
  { value: 'dynamic-select', label: '動態選單' },
  { value: 'select', label: '固定選單' },
  { value: 'link', label: '連結' },
  { value: 'datetime', label: '日期時間' },
];

export const WorkspacePasteDialog = ({ targetLabel, onClose, onApply }: {
  targetLabel: string;
  onClose(): void;
  onApply(matrix: string[][]): void;
}) => {
  const [text, setText] = useState('');
  const matrix = useMemo(() => parseWorkspaceClipboard(text), [text]);
  const width = Math.max(0, ...matrix.map((row) => row.length));
  return <WorkspaceModal owner="paste" title="貼上多格" dialogKind="editor" onRequestClose={onClose} className="workspace-paste-dialog" actions={<button type="button" className="workspace-dialog-button primary" disabled={!matrix.length || !width} onClick={() => onApply(matrix)}><WorkspaceIcon name="clipboard" size={18} />貼上 {matrix.length} × {width}</button>}>
    <div className="workspace-import-summary"><strong>起點：{targetLabel}</strong><span>超出範圍時會自動新增物件或屬性</span></div>
    <textarea autoFocus aria-label="貼上試算表內容" placeholder="在這裡貼上試算表內容" value={text} onChange={(event) => setText(event.target.value)} />
  </WorkspaceModal>;
};

const sourceLabels: Record<WorkspaceImportSource, string> = {
  plain: '一般試算表（已自動判斷欄位型態）',
  structured: 'Workspace 表格（含完整欄位設定）',
  workspace: 'Workspace 資料庫',
};

const chooseColumnType = (table: WorkspaceTable, columnId: string, inputType: WorkspaceInputType) => {
  const rowHeader = getRowHeaderColumn(table);
  const isRowHeader = rowHeader.id === columnId;
  const previous = isRowHeader ? rowHeader : table.columns.find((column) => column.id === columnId);
  if (!previous || previous.inputType === inputType) return table;
  const nextColumn = { ...previous, inputType };
  return isRowHeader
    ? { ...table, rowHeader: nextColumn }
    : { ...table, columns: table.columns.map((column) => column.id === columnId ? nextColumn : column) };
};

export const WorkspaceTableImportPreviewDialog = ({ table, source, onClose, onImport }: {
  table: WorkspaceTable;
  source: WorkspaceImportSource;
  onClose(): void;
  onImport(table: WorkspaceTable): void;
}) => {
  const [draft, setDraft] = useState(table);
  const [error, setError] = useState('');
  const columns = [getRowHeaderColumn(draft), ...draft.columns];
  const confirmImport = () => {
    let converted = table;
    const rowHeader = getRowHeaderColumn(table);
    try {
      for (const column of columns) {
        const isRowHeader = column.id === rowHeader.id;
        const previous = isRowHeader ? rowHeader : table.columns.find(item => item.id === column.id)!;
        converted = prepareWorkspaceColumnSave(converted, column).table;
        if (column.inputType === 'select' && previous.inputType !== 'select') {
          const options = [...new Set(converted.rows.map(row => isRowHeader ? row.name : row.values[column.id])
            .filter((value): value is string => typeof value === 'string' && Boolean(value)))];
          const current = isRowHeader ? getRowHeaderColumn(converted) : converted.columns.find(item => item.id === column.id)!;
          converted = prepareWorkspaceColumnSave(converted, { ...current, options }).table;
        }
      }
    } catch (failure) {
      if (!(failure instanceof WorkspaceColumnConversionError)) throw failure;
      setError(failure.message.replace('未儲存設定', '未匯入表格'));
      return;
    }
    setError('');
    onImport(converted);
  };
  return <WorkspaceModal owner="table-import" title="匯入預覽" dialogKind="editor" onRequestClose={onClose} className="workspace-import-preview-dialog" actions={<button type="button" className="workspace-dialog-button primary" onClick={confirmImport}><WorkspaceIcon name="upload" size={18} />匯入表格</button>}>
    <div className="workspace-import-summary"><strong>{draft.name}</strong><span>{sourceLabels[source]}</span><span>{draft.rows.length} 個物件 · {draft.columns.length} 個屬性</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="workspace-import-column-list">
      {columns.map((column, index) => <div className="workspace-import-column" key={column.id}>
        <span className="workspace-import-column-name"><small>{index === 0 ? '物件' : `屬性 ${index}`}</small>{column.name || '未命名'}</span>
        <select aria-label={`${column.name || '未命名欄位'}型態`} value={column.inputType} onChange={(event) => { setError(''); setDraft(current => chooseColumnType(current, column.id, event.target.value as WorkspaceInputType)); }}>
          {inputTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {column.inputType === 'datetime' && <label className="workspace-import-date-only"><input className="workspace-compact-checkbox" type="checkbox" checked={Boolean(column.dateOnly)} onChange={(event) => setDraft((current) => getRowHeaderColumn(current).id === column.id
          ? { ...current, rowHeader: { ...getRowHeaderColumn(current), dateOnly: event.target.checked } }
          : { ...current, columns: current.columns.map((item) => item.id === column.id ? { ...item, dateOnly: event.target.checked } : item) })} />只顯示日期</label>}
      </div>)}
    </div>
  </WorkspaceModal>;
};
