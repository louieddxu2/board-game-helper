import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadWorkspace, saveWorkspace } from '../workspace/db';
import { createColumn, createNode, createRow, createTable, getChildren, getDynamicOptions, getTableForNode, removeNodeAndDescendants } from '../workspace/model';
import { cloneImportedWorkspace, exportWorkspaceXlsx, importWorkspaceXlsx } from '../workspace/spreadsheet';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceNode, WorkspaceRow, WorkspaceTable } from '../workspace/types';

const inputTypeLabels: Record<WorkspaceInputType, string> = {
  text: '文字', number: '數字', select: '固定列表', 'dynamic-select': '動態列表',
};

type IconName = 'menu' | 'search' | 'edit' | 'check' | 'refresh' | 'close' | 'folder' | 'table' | 'chevron' | 'more' | 'plus' | 'settings' | 'trash' | 'back' | 'download' | 'upload' | 'rows' | 'columns' | 'home';

const WorkspaceIcon = ({ name, size = 24 }: { name: IconName; size?: number }) => {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'menu': return <svg {...common}><path d="M4 6h16M4 12h11M4 18h7" /></svg>;
    case 'search': return <svg {...common}><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 4 4" /></svg>;
    case 'edit': return <svg {...common}><path d="M12 20h8" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>;
    case 'check': return <svg {...common}><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="m7.5 12 3 3 6-6" /></svg>;
    case 'refresh': return <svg {...common}><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 4v7h-7" /></svg>;
    case 'close': return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'folder': return <svg {...common}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z" /></svg>;
    case 'table': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 14h18M9 4v16M15 4v16" /></svg>;
    case 'chevron': return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case 'more': return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
    case 'plus': return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'settings': return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.5v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6.5v-2.5h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V5h2.5v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v2.5h-.2a1.7 1.7 0 0 0-1.5 1Z" /></svg>;
    case 'trash': return <svg {...common}><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
    case 'back': return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></svg>;
    case 'download': return <svg {...common}><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></svg>;
    case 'upload': return <svg {...common}><path d="M12 15V3M7 8l5-5 5 5M4 20h16" /></svg>;
    case 'rows': return <svg {...common}><path d="M4 5h16M4 12h16M4 19h16" /><path d="M8 3v18" /></svg>;
    case 'columns': return <svg {...common}><path d="M5 4v16M12 4v16M19 4v16" /><path d="M3 8h18" /></svg>;
    case 'home': return <svg {...common}><path d="m4 11 8-7 8 7" /><path d="M6 10v9h12v-9M10 19v-5h4v5" /></svg>;
  }
};

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const fileBaseName = (name: string) => name.replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'workspace';

const updateTable = (data: WorkspaceData, tableId: string, updater: (table: WorkspaceTable) => WorkspaceTable): WorkspaceData => ({
  ...data,
  tables: data.tables.map((table) => table.id === tableId ? updater(table) : table),
});

const findTableNode = (data: WorkspaceData, tableId: string) => data.nodes.find((node) => node.type === 'table' && node.tableId === tableId);

const workspaceCellPadding = 34;
const workspaceMaxColumnWidth = 280;
const workspaceMinColumnWidth = 40;

const measureWorkspaceText = (text: string, fontSize: number, fontWeight: number) => {
  if (typeof document === 'undefined') return Math.max(fontSize, text.length * fontSize);
  if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator.userAgent)) return Math.max(fontSize, text.length * fontSize);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return Math.max(fontSize, text.length * fontSize);
  context.font = `${fontWeight} ${fontSize}px "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif`;
  return Math.max(...text.split('\n').map((line) => context.measureText(line || 'M').width));
};

interface CellEditorProps {
  column: WorkspaceColumn;
  value: WorkspaceCellValue;
  onSave(value: string): void;
  onCancel(): void;
}

const CellEditor = ({ column, value, onSave, onCancel }: CellEditorProps) => {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); if (inputRef.current instanceof HTMLInputElement) inputRef.current.select(); }, []);

  const commit = () => onSave(draft);
  if (column.inputType === 'number') return <input ref={inputRef as React.RefObject<HTMLInputElement>} className="workspace-cell-editor" type="number" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') onCancel(); }} />;
  return <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} className="workspace-cell-editor workspace-text-editor" inputMode="text" rows={Math.max(1, draft.split('\n').length)} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); } }} />;
};

const WorkspaceModal = ({ title, children, actions, onClose, className = '' }: { title: string; children: React.ReactNode; actions?: React.ReactNode; onClose(): void; className?: string }) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className={`workspace-overlay ${className ? `${className}-overlay` : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`workspace-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
      <header className="workspace-dialog-heading"><h2 id="workspace-dialog-title">{title}</h2><button type="button" className="workspace-icon-button" onClick={onClose} aria-label="關閉"><WorkspaceIcon name="close" size={21} /></button></header>
      <div className="workspace-dialog-content">{children}</div>
      {actions && <footer className="workspace-dialog-actions">{actions}</footer>}
    </section>
  </div>;
};

type NameDialogState = { mode: 'folder' | 'table' | 'row' | 'axis' | 'rename'; initialValue: string; parentId?: string | null; node?: WorkspaceNode; row?: WorkspaceRow; table?: WorkspaceTable };

const NameDialog = ({ state, onClose, onSubmit, onDelete }: { state: NameDialogState; onClose(): void; onSubmit(name: string): void; onDelete?(): void }) => {
  const [name, setName] = useState(state.initialValue);
  const label = state.mode === 'folder' ? '資料夾名稱' : state.mode === 'table' ? '表格名稱' : state.mode === 'row' ? '項目名稱' : state.mode === 'axis' ? '項目軸名稱' : '名稱';
  const title = state.mode === 'folder' ? '新增資料夾' : state.mode === 'table' ? '新增表格' : state.mode === 'row' ? '編輯項目名稱' : state.mode === 'axis' ? '編輯項目軸' : '重新命名';
  return <WorkspaceModal title={title} onClose={onClose} className="workspace-name-dialog" actions={<>{onDelete && <button type="button" className="workspace-dialog-button danger" onClick={onDelete}>刪除項目</button>}<button type="button" className="workspace-dialog-button secondary" onClick={onClose}>取消</button><button type="button" className="workspace-dialog-button primary" onClick={() => { const value = name.trim(); if (value) onSubmit(value); }}>確定</button></>}>
    <label className="workspace-form-field">{label}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const value = name.trim(); if (value) onSubmit(value); } }} /></label>
  </WorkspaceModal>;
};

const ConfirmDialog = ({ title, message, onClose, onConfirm }: { title: string; message: string; onClose(): void; onConfirm(): void }) => <WorkspaceModal title={title} onClose={onClose} className="workspace-confirm-dialog" actions={<><button type="button" className="workspace-dialog-button secondary" onClick={onClose}>取消</button><button type="button" className="workspace-dialog-button danger" onClick={onConfirm}>刪除</button></>}><p className="workspace-dialog-message">{message}</p></WorkspaceModal>;

const WorkspaceSelectionDialog = ({ column, value, options, onClose, onSelect }: { column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; onClose(): void; onSelect(value: string): void }) => {
  const currentValue = value == null ? '' : String(value);
  const isDynamic = column.inputType === 'dynamic-select';
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? options.filter((option) => option.toLocaleLowerCase().includes(normalized)) : options;
  }, [options, query]);
  const normalizedQuery = query.trim();
  useEffect(() => {
    const selected = selectedOptionRef.current;
    if (selected && typeof selected.scrollIntoView === 'function') selected.scrollIntoView({ block: 'center' });
  }, [currentValue, options]);
  const choose = (nextValue: string) => onSelect(nextValue);
  const submitQuery = () => { if (normalizedQuery) choose(normalizedQuery); };

  return <WorkspaceModal title={column.name} onClose={onClose} className="workspace-selection-dialog">
    {isDynamic && <label className="workspace-selection-search"><WorkspaceIcon name="search" size={20} /><span className="sr-only">搜尋或新增選項</span><input ref={inputRef} inputMode="text" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitQuery(); } }} placeholder="搜尋或輸入…" /><button type="button" onClick={() => setQuery('')} aria-label="清除搜尋"><WorkspaceIcon name="close" size={18} /></button></label>}
    <div className="workspace-selection-list" role="listbox" aria-label={`${column.name}選項`}>
      {filtered.map((option) => <button ref={option === currentValue ? selectedOptionRef : undefined} type="button" key={option} role="option" aria-selected={option === currentValue} className={option === currentValue ? 'selected' : ''} onClick={() => choose(option)}>{option}</button>)}
      {!filtered.length && !(isDynamic && normalizedQuery) && <p className="workspace-selection-empty">目前沒有可選項目</p>}
    </div>
  </WorkspaceModal>;
};

const SelectionOptionsEditor = ({ options, onChange }: { options: string[]; onChange(options: string[]): void }) => {
  const visibleOptions = options.length ? options : [''];
  const updateOption = (index: number, value: string) => {
    const next = options.length ? [...options] : [''];
    next[index] = value;
    onChange(next);
  };
  const addOption = () => onChange([...options, '']);
  const removeOption = (index: number) => onChange(options.filter((_, optionIndex) => optionIndex !== index));

  return <div className="workspace-option-list">
    {visibleOptions.map((option, index) => <div className="workspace-option-row" key={index}>
      <textarea rows={2} value={option} aria-label={`固定選項 ${index + 1}`} placeholder={`選項 ${index + 1}`} onChange={(event) => updateOption(index, event.target.value)} />
      <button type="button" className="workspace-option-remove" onClick={() => removeOption(index)} aria-label={`刪除固定選項 ${index + 1}`}><WorkspaceIcon name="trash" size={18} /></button>
    </div>)}
    <button type="button" className="workspace-option-add" onClick={addOption}><WorkspaceIcon name="plus" size={18} />新增選項</button>
  </div>;
};

const ColumnConfig = ({ column, onSave, onDelete, onClose }: { column: WorkspaceColumn; onSave(column: WorkspaceColumn): void; onDelete(): void; onClose(): void }) => {
  const [draft, setDraft] = useState(column);
  const save = () => onSave({ ...draft, name: draft.name.trim() || '未命名欄位', options: draft.inputType === 'select' ? draft.options.map((option) => option.trim()).filter(Boolean) : [] });
  const chooseInputType = (inputType: WorkspaceInputType) => setDraft((current) => ({ ...current, inputType, options: inputType === 'select' ? current.options : [] }));
  return <WorkspaceModal title="欄位設定" onClose={onClose} className="workspace-column-dialog" actions={<><button type="button" className="workspace-dialog-button danger" onClick={onDelete}>刪除欄位</button><button type="button" className="workspace-dialog-button secondary" onClick={onClose}>取消</button><button type="button" className="workspace-dialog-button primary" onClick={save}>儲存</button></>}>
    <label className="workspace-form-field">欄位名稱<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <fieldset className="workspace-form-field workspace-input-type-field"><legend>輸入類型</legend><div className="workspace-input-type-options">{Object.entries(inputTypeLabels).map(([value, label]) => <button type="button" key={value} className={draft.inputType === value ? 'selected' : ''} onClick={() => chooseInputType(value as WorkspaceInputType)}>{label}</button>)}</div></fieldset>
    {draft.inputType === 'select' && <div className="workspace-form-field"><span>固定選項</span><SelectionOptionsEditor options={draft.options} onChange={(options) => setDraft((current) => ({ ...current, options }))} /></div>}
  </WorkspaceModal>;
};

const TreeNode = ({ node, data, expanded, depth, onToggle, onOpen, onContext }: { node: WorkspaceNode; data: WorkspaceData; expanded: Set<string>; depth: number; onToggle(id: string): void; onOpen(node: WorkspaceNode): void; onContext(node: WorkspaceNode): void }) => {
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const children = node.type === 'folder' ? getChildren(data, node.id) : [];
  const isOpen = expanded.has(node.id);
  const clearTimer = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = undefined; };
  return <div className="workspace-tree-item">
    <div className={`workspace-tree-row ${data.activeNodeId === node.id ? 'active' : ''}`} style={{ '--workspace-depth': depth } as React.CSSProperties} onPointerDown={(event) => { if (event.pointerType === 'mouse' && event.button !== 0) return; longPressed.current = false; timer.current = window.setTimeout(() => { longPressed.current = true; onContext(node); }, 560); }} onPointerUp={clearTimer} onPointerCancel={clearTimer} onContextMenu={(event) => { event.preventDefault(); clearTimer(); onContext(node); }} onClick={(event) => { if (longPressed.current) { longPressed.current = false; event.preventDefault(); return; } if (node.type === 'folder') onToggle(node.id); else onOpen(node); }}>
      {node.type === 'folder' ? <span className={`workspace-tree-toggle ${isOpen ? 'open' : ''}`} aria-hidden="true"><WorkspaceIcon name="chevron" size={17} /></span> : <span className="workspace-tree-spacer" />}
      <span className="workspace-tree-name"><WorkspaceIcon name={node.type === 'folder' ? 'folder' : 'table'} size={19} /><span className="workspace-tree-name-text">{node.name}</span></span>
      <button type="button" className="workspace-tree-more" aria-label={`開啟${node.name}操作`} onClick={(event) => { event.stopPropagation(); onContext(node); }}><WorkspaceIcon name="more" size={19} /></button>
    </div>
    {node.type === 'folder' && isOpen && <div className="workspace-tree-children">{children.map((child) => <TreeNode key={child.id} node={child} data={data} expanded={expanded} depth={depth + 1} onToggle={onToggle} onOpen={onOpen} onContext={onContext} />)}</div>}
  </div>;
};

const Tree = ({ data, expanded, onToggle, onOpen, onContext }: { data: WorkspaceData; expanded: Set<string>; onToggle(id: string): void; onOpen(node: WorkspaceNode): void; onContext(node: WorkspaceNode): void }) => <div className="workspace-tree">
  {getChildren(data, null).map((node) => <TreeNode key={node.id} node={node} data={data} expanded={expanded} depth={0} onToggle={onToggle} onOpen={onOpen} onContext={onContext} />)}
  {!data.nodes.some((node) => node.parentId === null) && <p className="workspace-tree-empty">尚未建立資料夾或表格</p>}
</div>;

const NodeActionsDialog = ({ node, onClose, onOpen, onRename, onDelete, onAddFolder, onAddTable }: { node: WorkspaceNode; onClose(): void; onOpen(): void; onRename(): void; onDelete(): void; onAddFolder(): void; onAddTable(): void }) => <WorkspaceModal title={node.name} onClose={onClose} className="workspace-action-dialog">
  <div className="workspace-action-list">
    {node.type === 'table' && <button type="button" onClick={onOpen}><WorkspaceIcon name="table" size={21} />開啟表格</button>}
    {node.type === 'folder' && <><button type="button" onClick={onAddTable}><WorkspaceIcon name="table" size={21} />在此新增表格</button><button type="button" onClick={onAddFolder}><WorkspaceIcon name="folder" size={21} />在此新增資料夾</button></>}
    <button type="button" onClick={onRename}><WorkspaceIcon name="edit" size={21} />重新命名</button>
    <button type="button" className="danger" onClick={onDelete}><WorkspaceIcon name="trash" size={21} />刪除</button>
  </div>
</WorkspaceModal>;

const TableActionsDialog = ({ tableName, onClose, onRename, onAddRow, onAddColumn, onExport, onImportTable, onExportAll, onImportAll }: { tableName: string; onClose(): void; onRename(): void; onAddRow(): void; onAddColumn(): void; onExport(): void; onImportTable(): void; onExportAll(): void; onImportAll(): void }) => <WorkspaceModal title={tableName} onClose={onClose} className="workspace-action-dialog">
  <div className="workspace-action-list">
    <button type="button" onClick={onAddRow}><WorkspaceIcon name="rows" size={21} />新增項目</button>
    <button type="button" onClick={onAddColumn}><WorkspaceIcon name="columns" size={21} />新增欄位</button>
    <button type="button" onClick={onRename}><WorkspaceIcon name="edit" size={21} />重新命名表格</button>
    <div className="workspace-action-divider" />
    <button type="button" onClick={onExport}><WorkspaceIcon name="download" size={21} />匯出此表</button>
    <button type="button" onClick={onImportTable}><WorkspaceIcon name="upload" size={21} />匯入單表</button>
    <button type="button" onClick={onExportAll}><WorkspaceIcon name="download" size={21} />匯出全部資料</button>
    <button type="button" onClick={onImportAll}><WorkspaceIcon name="upload" size={21} />匯入整個資料庫</button>
  </div>
</WorkspaceModal>;

const WorkspacePage = () => {
  const [data, setData] = useState<WorkspaceData>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rowId: string; columnId: string }>();
  const [selectionEditor, setSelectionEditor] = useState<{ rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[] }>();
  const [configuring, setConfiguring] = useState<WorkspaceColumn>();
  const [workspaceImport, setWorkspaceImport] = useState<WorkspaceData>();
  const [nodeMenu, setNodeMenu] = useState<WorkspaceNode>();
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialogState>();
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm(): void }>();
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [textScale, setTextScale] = useState(1);
  const [minTextScale, setMinTextScale] = useState(0.35);
  const [viewportWidth, setViewportWidth] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | undefined>(undefined);

  const reload = useCallback(async () => {
    const loaded = await loadWorkspace();
    setData(loaded);
    setExpanded(new Set(loaded.nodes.filter((node) => node.type === 'folder').map((node) => node.id)));
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const commit = useCallback((next: WorkspaceData) => { setData(next); void saveWorkspace(next); }, []);
  const table = useMemo(() => data ? getTableForNode(data, data.activeNodeId) : undefined, [data]);
  const tableNode = useMemo(() => table && data ? findTableNode(data, table.id) : undefined, [data, table]);
  const columnTextWidths = useMemo(() => {
    if (!table) return [];
    const itemHeaderWidth = Math.max(
      measureWorkspaceText(table.rowHeaderName, 20, 600),
      ...table.rows.map((row) => measureWorkspaceText(row.name, 20, 400)),
    );
    return [itemHeaderWidth, ...table.columns.map((column) => measureWorkspaceText(column.name, 20, 600))];
  }, [table]);
  const columnWidths = useMemo(() => columnTextWidths.map((textWidth) => Math.min(workspaceMaxColumnWidth, Math.max(workspaceMinColumnWidth, textWidth * textScale + workspaceCellPadding))), [columnTextWidths, textScale]);
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
  const visibleRows = useMemo(() => {
    if (!table || !searchQuery.trim()) return table?.rows ?? [];
    const query = searchQuery.trim().toLocaleLowerCase();
    return table.rows.filter((row) => table.columns.some((column) => String(row.values[column.id] ?? '').toLocaleLowerCase().includes(query)));
  }, [searchQuery, table]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const update = () => setViewportWidth(viewport.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [table]);

  useEffect(() => {
    if (!columnTextWidths.length || !viewportWidth) return;
    const textWidth = columnTextWidths.reduce((total, width) => total + width, 0);
    const availableTextWidth = Math.max(1, viewportWidth - columnTextWidths.length * workspaceCellPadding);
    setMinTextScale(Math.min(1, Math.max(0.1, availableTextWidth / textWidth)));
  }, [columnTextWidths, viewportWidth]);

  useEffect(() => {
    setTextScale((current) => Math.max(minTextScale, Math.min(4, current)));
  }, [minTextScale]);

  const openNameDialog = (mode: NameDialogState['mode'], initialValue: string, parentId?: string | null, node?: WorkspaceNode) => setNameDialog({ mode, initialValue, parentId, node });
  const addFolder = (parentId: string | null) => openNameDialog('folder', '', parentId);
  const addTable = (parentId: string | null) => openNameDialog('table', '', parentId);
  const renameNode = (node: WorkspaceNode) => openNameDialog('rename', node.name, undefined, node);
  const renameRow = (row: WorkspaceRow) => setNameDialog({ mode: 'row', initialValue: row.name, row });
  const renameRowHeader = (currentTable: WorkspaceTable) => setNameDialog({ mode: 'axis', initialValue: currentTable.rowHeaderName, table: currentTable });

  const submitName = (name: string) => {
    if (!data || !nameDialog) return;
    if (nameDialog.mode === 'folder' || nameDialog.mode === 'table') {
      const parentId = nameDialog.parentId ?? null;
      if (nameDialog.mode === 'folder') {
        const node = createNode('folder', name, parentId, getChildren(data, parentId).length);
        commit({ ...data, nodes: [...data.nodes, node] });
        setExpanded((current) => new Set(current).add(parentId ?? node.id));
      } else {
        const currentTable = createTable(name);
        const node = createNode('table', currentTable.name, parentId, getChildren(data, parentId).length, currentTable.id);
        commit({ ...data, tables: [...data.tables, currentTable], nodes: [...data.nodes, node], activeNodeId: node.id });
        setExpanded((current) => new Set(current).add(parentId ?? node.id));
        setDrawerOpen(false);
      }
    } else if (nameDialog.row && table) {
      const rowId = nameDialog.row.id;
      commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.map((row) => row.id === rowId ? { ...row, name } : row) })));
    } else if (nameDialog.table && table) {
      commit(updateTable(data, table.id, (current) => ({ ...current, rowHeaderName: name, updatedAt: Date.now() })));
    } else if (nameDialog.node) {
      const node = nameDialog.node;
      const next = { ...data, nodes: data.nodes.map((item) => item.id === node.id ? { ...item, name } : item), tables: node.tableId ? data.tables.map((item) => item.id === node.tableId ? { ...item, name, updatedAt: Date.now() } : item) : data.tables };
      commit(next);
    }
    setNameDialog(undefined);
  };

  const askDeleteNode = (node: WorkspaceNode) => setConfirmDialog({ title: '確認刪除', message: `確定要刪除「${node.name}」嗎？${node.type === 'folder' ? '資料夾內的內容也會一併刪除。' : ''}`, onConfirm: () => { if (data) commit(removeNodeAndDescendants(data, node.id)); setConfirmDialog(undefined); setNodeMenu(undefined); } });
  const openNode = (node: WorkspaceNode) => { if (!data) return; if (node.type === 'folder') { setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); return; } commit({ ...data, activeNodeId: node.id }); setDrawerOpen(false); setNodeMenu(undefined); };

  const updateCell = (rowId: string, column: WorkspaceColumn, raw: string) => {
    if (!data || !table) return;
    if (column.inputType === 'number' && raw.trim() && !Number.isFinite(Number(raw))) { setNotice('請輸入有效數字'); return; }
    const value: WorkspaceCellValue = !raw.trim() ? null : column.inputType === 'number' ? (Number.isFinite(Number(raw)) ? Number(raw) : null) : raw;
    commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.map((row) => row.id === rowId ? { ...row, values: { ...row.values, [column.id]: value } } : row) })));
    setEditing(undefined);
  };
  const openCell = (row: WorkspaceRow, column: WorkspaceColumn) => {
    if (!table) return;
    const value = row.values[column.id];
    if (column.inputType === 'select' || column.inputType === 'dynamic-select') {
      setEditing(undefined);
      setSelectionEditor({ rowId: row.id, column, value, options: column.inputType === 'dynamic-select' ? getDynamicOptions(table, column.id) : column.options });
      return;
    }
    setEditing({ rowId: row.id, columnId: column.id });
  };
  const selectCellValue = (value: string) => {
    if (!selectionEditor) return;
    updateCell(selectionEditor.rowId, selectionEditor.column, value);
    setSelectionEditor(undefined);
  };
  const addRow = () => { if (!data || !table) return; commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: [...current.rows, createRow(current.columns, `項目 ${current.rows.length + 1}`)] }))); setTableActionsOpen(false); };
  const askDeleteRow = (row: WorkspaceRow, rowIndex: number) => setConfirmDialog({ title: '刪除項目', message: `確定要刪除「${row.name || `項目 ${rowIndex + 1}`}」嗎？`, onConfirm: () => { if (data && table) commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.filter((item) => item.id !== row.id) }))); setConfirmDialog(undefined); } });
  const addColumn = () => { if (!data || !table) return; const column = createColumn(`欄位 ${table.columns.length + 1}`); commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: [...current.columns, column], rows: current.rows.map((row) => ({ ...row, values: { ...row.values, [column.id]: null } })) }))); setConfiguring(column); setTableActionsOpen(false); };
  const askDeleteColumn = (column: WorkspaceColumn) => setConfirmDialog({ title: '刪除欄位', message: `確定要刪除欄位「${column.name}」嗎？此欄的資料也會一併刪除。`, onConfirm: () => { if (data && table) commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: current.columns.filter((item) => item.id !== column.id), rows: current.rows.map((row) => { const values = { ...row.values }; delete values[column.id]; return { ...row, values }; }) }))); setConfirmDialog(undefined); } });
  const saveColumn = (column: WorkspaceColumn) => { if (!data || !table) return; commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: current.columns.map((item) => item.id === column.id ? column : item) }))); setConfiguring(undefined); };

  const exportCurrent = () => { if (!data || !table) return; download(exportWorkspaceXlsx(data, table), `${fileBaseName(table.name)}.xlsx`); setTableActionsOpen(false); setNotice('已匯出目前表格'); };
  const exportAll = () => { if (!data) return; download(exportWorkspaceXlsx(data), 'workspace.xlsx'); setTableActionsOpen(false); setNotice('已匯出整個資料庫'); };
  const chooseImport = (kind: 'table' | 'workspace') => { setTableActionsOpen(false); const input = document.getElementById(`workspace-import-${kind}`) as HTMLInputElement | null; input?.click(); };
  const readImport = async (file: File, kind: 'table' | 'workspace') => {
    try {
      const imported = await importWorkspaceXlsx(file);
      if (kind === 'table') {
        if (imported.isWorkspace || !imported.table || !data) throw new Error('請選擇單張表格檔案');
        const tableCopy = imported.table;
        const node = createNode('table', tableCopy.name, null, getChildren(data, null).length, tableCopy.id);
        commit({ ...data, tables: [...data.tables, tableCopy], nodes: [...data.nodes, node], activeNodeId: node.id }); setNotice('單張表格已匯入'); setDrawerOpen(false);
      } else {
        if (!imported.isWorkspace || !imported.data || !data) throw new Error('請選擇整個資料庫檔案');
        setWorkspaceImport(imported.data);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : '匯入失敗'); }
  };
  const finishWorkspaceImport = (mode: 'replace' | 'merge') => {
    if (!data || !workspaceImport) return;
    const next = mode === 'replace' ? { ...workspaceImport, activeNodeId: workspaceImport.nodes.find((node) => node.type === 'table')?.id ?? null } : (() => { const copy = cloneImportedWorkspace(workspaceImport); return { ...data, nodes: [...data.nodes, ...copy.nodes], tables: [...data.tables, ...copy.tables], activeNodeId: copy.nodes.find((node) => node.type === 'table')?.id ?? data.activeNodeId }; })();
    commit(next); setWorkspaceImport(undefined); setNotice(mode === 'replace' ? '資料庫已取代' : '資料庫已合併');
  };

  if (!data) return <section className="workspace-page workspace-loading"><p>正在開啟本地 Workspace…</p></section>;
  return <section className="workspace-page">
    <h1 className="sr-only">動態表格</h1>
    <header className="workspace-appbar">
      <div className="workspace-appbar-leading"><button type="button" className="workspace-appbar-button workspace-menu-button" aria-label="開啟目錄" onClick={() => setDrawerOpen(true)}><WorkspaceIcon name="menu" size={29} /></button><div className="workspace-appbar-title"><span>{table?.name ?? '動態表格'}</span><small>LOCAL</small></div></div>
      <div className="workspace-appbar-actions">
        <button type="button" className={`workspace-appbar-button ${searchOpen ? 'active' : ''}`} aria-label="搜尋表格" onClick={() => { setSearchOpen((current) => !current); setSearchQuery(''); }}><WorkspaceIcon name="search" size={29} /></button>
        <button type="button" className={`workspace-appbar-button ${tableActionsOpen ? 'active' : ''}`} aria-label="編輯表格" onClick={() => setTableActionsOpen(true)} disabled={!table}><WorkspaceIcon name="edit" size={29} /></button>
        <button type="button" className="workspace-appbar-button" aria-label="完成並儲存" onClick={() => setNotice('資料已儲存於本機')}><WorkspaceIcon name="check" size={29} /></button>
        <button type="button" className="workspace-appbar-button" aria-label="重新整理資料" onClick={() => { void reload(); setNotice('已重新整理'); }}><WorkspaceIcon name="refresh" size={30} /></button>
      </div>
    </header>
    {searchOpen && <div className="workspace-searchbar"><WorkspaceIcon name="search" size={21} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜尋目前表格…" /><button type="button" onClick={() => { setSearchQuery(''); setSearchOpen(false); }} aria-label="關閉搜尋"><WorkspaceIcon name="close" size={19} /></button></div>}
    {notice && <div className="workspace-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="關閉通知"><WorkspaceIcon name="close" size={17} /></button></div>}
    <div className={`workspace-body ${drawerOpen ? 'drawer-is-open' : ''}`}>
      <main className="workspace-main">
        {!table || !tableNode ? <div className="workspace-empty"><div className="workspace-empty-icon"><WorkspaceIcon name="table" size={34} /></div><h2>建立你的第一張表格</h2><p>資料只會儲存在這個瀏覽器。你可以建立桌遊收藏，也可以建立任何自己的資料表。</p><button type="button" className="workspace-dialog-button primary" onClick={() => addTable(null)}>建立表格</button></div> : <>
          <div ref={viewportRef} className="workspace-table-viewport" onWheel={(event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); setTextScale((current) => Math.max(minTextScale, Math.min(4, current - event.deltaY * 0.002))); } }} onPointerDown={(event) => { if (event.pointerType === 'touch') { pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.current.size === 2) { const points = [...pointers.current.values()]; pinchStart.current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), scale: textScale }; } } }} onPointerMove={(event) => { if (event.pointerType !== 'touch' || !pointers.current.has(event.pointerId)) return; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.current.size === 2 && pinchStart.current) { const points = [...pointers.current.values()]; const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); setTextScale(Math.max(minTextScale, Math.min(4, pinchStart.current.scale * distance / pinchStart.current.distance))); event.preventDefault(); } }} onPointerUp={(event) => { pointers.current.delete(event.pointerId); if (pointers.current.size < 2) pinchStart.current = undefined; }} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); pinchStart.current = undefined; }}>
            <table className="workspace-table" style={{ '--workspace-text-scale': textScale, width: `${tableWidth}px` } as React.CSSProperties}>
              <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width: `${width}px` }} />)}</colgroup>
              <thead><tr><th className="workspace-row-corner"><button type="button" className="workspace-row-axis-name" onClick={() => renameRowHeader(table)}>{table.rowHeaderName}</button></th>{table.columns.map((column) => <th key={column.id} onContextMenu={(event) => { event.preventDefault(); setConfiguring(column); }}><button type="button" className="workspace-column-name" onClick={() => setConfiguring(column)}>{column.name}</button></th>)}</tr></thead>
              <tbody>{visibleRows.map((row) => { const originalIndex = table.rows.findIndex((item) => item.id === row.id); return <tr key={row.id}><th className="workspace-row-heading" onContextMenu={(event) => { event.preventDefault(); askDeleteRow(row, originalIndex); }}><button type="button" className="workspace-row-name" onClick={() => renameRow(row)} aria-label={`編輯項目 ${row.name}`}>{row.name}</button></th>{table.columns.map((column) => { const isEditing = editing?.rowId === row.id && editing.columnId === column.id; const value = row.values[column.id]; return <td key={column.id} onClick={() => !isEditing && openCell(row, column)}>{isEditing ? <CellEditor column={column} value={value} onSave={(next) => updateCell(row.id, column, next)} onCancel={() => setEditing(undefined)} /> : <span className={value == null || value === '' ? 'workspace-empty-cell' : ''}>{value == null || value === '' ? '點按輸入' : String(value)}</span>}</td>; })}</tr>; })}</tbody>
            </table>
          </div>
          <div className="workspace-zoom-indicator"><button type="button" onClick={() => setTextScale((current) => Math.max(minTextScale, current - 0.1))} aria-label="縮小文字">−</button><span>{Math.round(textScale * 100)}%</span><button type="button" onClick={() => setTextScale((current) => Math.min(4, current + 0.1))} aria-label="放大文字">＋</button><button type="button" onClick={() => setTextScale(minTextScale)} aria-label="縮到可完整顯示欄位">適合寬度</button></div>
        </>}
      </main>
      <button type="button" className="workspace-fab" onClick={addRow} disabled={!table} aria-label="新增項目"><WorkspaceIcon name="plus" size={38} /></button>
    </div>
    {drawerOpen && <><button type="button" className="workspace-drawer-backdrop" aria-label="關閉目錄" onClick={() => setDrawerOpen(false)} /><aside className="workspace-drawer" aria-label="Workspace 目錄"><header className="workspace-drawer-heading"><strong>目錄</strong><div><button type="button" onClick={() => addFolder(null)} aria-label="新增資料夾"><WorkspaceIcon name="folder" size={22} /></button><button type="button" onClick={() => addTable(null)} aria-label="新增表格"><WorkspaceIcon name="table" size={22} /></button><button type="button" onClick={() => setDrawerOpen(false)} aria-label="關閉目錄"><WorkspaceIcon name="close" size={22} /></button></div></header><Tree data={data} expanded={expanded} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={openNode} onContext={setNodeMenu} /><footer className="workspace-drawer-footer"><a href="/"><WorkspaceIcon name="home" size={19} />返回網站</a></footer></aside></>}
    <input id="workspace-import-table" hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'table'); event.currentTarget.value = ''; }} />
    <input id="workspace-import-workspace" hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'workspace'); event.currentTarget.value = ''; }} />
    {nodeMenu && <NodeActionsDialog node={nodeMenu} onClose={() => setNodeMenu(undefined)} onOpen={() => openNode(nodeMenu)} onRename={() => { setNodeMenu(undefined); renameNode(nodeMenu); }} onDelete={() => askDeleteNode(nodeMenu)} onAddFolder={() => { setNodeMenu(undefined); addFolder(nodeMenu.id); }} onAddTable={() => { setNodeMenu(undefined); addTable(nodeMenu.id); }} />}
    {tableActionsOpen && table && <TableActionsDialog tableName={table.name} onClose={() => setTableActionsOpen(false)} onRename={() => { setTableActionsOpen(false); if (tableNode) renameNode(tableNode); }} onAddRow={addRow} onAddColumn={addColumn} onExport={exportCurrent} onImportTable={() => chooseImport('table')} onExportAll={exportAll} onImportAll={() => chooseImport('workspace')} />}
    {nameDialog && <NameDialog state={nameDialog} onClose={() => setNameDialog(undefined)} onSubmit={submitName} onDelete={nameDialog.row ? () => { const row = nameDialog.row!; setNameDialog(undefined); askDeleteRow(row, table?.rows.findIndex((item) => item.id === row.id) ?? 0); } : undefined} />}
    {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} onClose={() => setConfirmDialog(undefined)} onConfirm={confirmDialog.onConfirm} />}
    {configuring && <ColumnConfig column={configuring} onSave={saveColumn} onDelete={() => { askDeleteColumn(configuring); setConfiguring(undefined); }} onClose={() => setConfiguring(undefined)} />}
    {selectionEditor && <WorkspaceSelectionDialog column={selectionEditor.column} value={selectionEditor.value} options={selectionEditor.options} onClose={() => setSelectionEditor(undefined)} onSelect={selectCellValue} />}
    {workspaceImport && <WorkspaceModal title="匯入整個資料庫" onClose={() => setWorkspaceImport(undefined)} actions={<button type="button" className="workspace-dialog-button secondary" onClick={() => setWorkspaceImport(undefined)}>取消</button>}><p className="workspace-dialog-message">要如何處理目前瀏覽器中的資料？</p><div className="workspace-import-actions"><button type="button" className="workspace-dialog-button secondary" onClick={() => finishWorkspaceImport('merge')}>合併</button><button type="button" className="workspace-dialog-button danger" onClick={() => finishWorkspaceImport('replace')}>取代</button></div></WorkspaceModal>}
  </section>;
};

export { WorkspacePage };
