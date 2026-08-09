import { forwardRef, useCallback, useDeferredValue, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadWorkspace, saveWorkspace } from '../workspace/db';
import { createColumn, createNode, createRow, createTable, displayWorkspaceCellValue, formatWorkspaceDateTime, getChildren, getDynamicOptions, getRowHeaderColumn, getTableForNode, isWorkspaceLinkValue, moveNode, normalizeWorkspaceDateTime, removeNodeAndDescendants, resolveActiveTableNodeId } from '../workspace/model';
import { cloneImportedWorkspace, exportWorkspaceXlsx, importWorkspaceXlsx } from '../workspace/spreadsheet';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceLinkValue, WorkspaceNode, WorkspaceOverflowMode, WorkspaceRow, WorkspaceTable, WorkspaceTextAlign } from '../workspace/types';

type WorkspaceInputCategory = 'text' | 'select' | 'other';

const inputCategoryLabels: Record<WorkspaceInputCategory, string> = {
  text: '文字', select: '選單', other: '其他',
};

const inputSubtypeLabels: Record<WorkspaceInputCategory, Array<{ value: WorkspaceInputType; label: string }>> = {
  text: [{ value: 'text', label: '文字' }, { value: 'number', label: '數字' }],
  select: [{ value: 'dynamic-select', label: '動態列表' }, { value: 'select', label: '固定列表' }],
  other: [{ value: 'datetime', label: '時間(含日期)' }, { value: 'link', label: '連結' }],
};

const inputCategoryFor = (inputType: WorkspaceInputType): WorkspaceInputCategory => inputType === 'select' || inputType === 'dynamic-select' ? 'select' : inputType === 'link' || inputType === 'datetime' ? 'other' : 'text';

const defaultInputTypeFor = (category: WorkspaceInputCategory): WorkspaceInputType => category === 'select' ? 'dynamic-select' : category === 'other' ? 'datetime' : 'text';

const overflowModeLabels: Record<WorkspaceOverflowMode, string> = {
  expand: '推擠寬度', ellipsis: '超過省略', wrap: '自動換行',
};

type IconName = 'menu' | 'search' | 'filter' | 'edit' | 'check' | 'refresh' | 'close' | 'folder' | 'folder-plus' | 'table' | 'table-plus' | 'chevron' | 'more' | 'plus' | 'settings' | 'trash' | 'back' | 'download' | 'upload' | 'rows' | 'columns' | 'home' | 'up' | 'down' | 'move' | 'align-left' | 'align-center' | 'align-right' | 'external';

const WorkspaceIcon = ({ name, size = 24 }: { name: IconName; size?: number }) => {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'menu': return <svg {...common}><path d="M4 6h16M4 12h11M4 18h7" /></svg>;
    case 'search': return <svg {...common}><circle cx="10.8" cy="10.8" r="6.5" /><path d="m16 16 4 4" /></svg>;
    case 'filter': return <svg {...common}><path d="M4 5h16l-6.5 7.2V19l-3 1v-7.8Z" /></svg>;
    case 'edit': return <svg {...common}><path d="M12 20h8" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>;
    case 'check': return <svg {...common}><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="m7.5 12 3 3 6-6" /></svg>;
    case 'refresh': return <svg {...common}><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 4v7h-7" /></svg>;
    case 'close': return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'folder': return <svg {...common}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z" /></svg>;
    case 'folder-plus': return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 10v6M9 13h6" /></svg>;
    case 'table': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 14h18M9 4v16M15 4v16" /></svg>;
    case 'table-plus': return <svg {...common}><rect x="3" y="4" width="14" height="16" rx="1.5" /><path d="M3 9h14M8 4v16M20 10v8M16 14h8" /></svg>;
    case 'chevron': return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case 'more': return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
    case 'plus': return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'settings': return <svg {...common}><path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h9M17 18h3" /><circle cx="13" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="15" cy="18" r="2" /></svg>;
    case 'trash': return <svg {...common}><path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
    case 'back': return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></svg>;
    case 'download': return <svg {...common}><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></svg>;
    case 'upload': return <svg {...common}><path d="M12 15V3M7 8l5-5 5 5M4 20h16" /></svg>;
    case 'rows': return <svg {...common}><path d="M4 5h16M4 12h16M4 19h16" /><path d="M8 3v18" /></svg>;
    case 'columns': return <svg {...common}><rect x="3" y="4" width="13" height="16" rx="1.5" /><path d="M8 4v16M3 9h13M20 10v8M16 14h8" /></svg>;
    case 'home': return <svg {...common}><path d="m4 11 8-7 8 7" /><path d="M6 10v9h12v-9M10 19v-5h4v5" /></svg>;
    case 'up': return <svg {...common}><path d="m6 15 6-6 6 6" /></svg>;
    case 'down': return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case 'move': return <svg {...common}><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" /></svg>;
    case 'align-left': return <svg {...common}><path d="M4 6h16M4 10h10M4 14h16M4 18h12" /></svg>;
    case 'align-center': return <svg {...common}><path d="M4 6h16M7 10h10M4 14h16M6 18h12" /></svg>;
    case 'align-right': return <svg {...common}><path d="M4 6h16M10 10h10M4 14h16M8 18h12" /></svg>;
    case 'external': return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></svg>;
  }
};

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const fileBaseName = (name: string) => name.replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'workspace';

const externalHref = (raw: string) => {
  const value = raw.trim();
  if (!value) return '';
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
};

const searchableWorkspaceCellValue = (value: WorkspaceCellValue, inputType?: WorkspaceInputType) => isWorkspaceLinkValue(value)
  ? `${value.label}\n${value.url}`
  : inputType === 'datetime' ? formatWorkspaceDateTime(value) : value == null ? '' : String(value);

const workspaceFilterValueKey = (value: WorkspaceCellValue) => value == null
  ? 'empty:'
  : typeof value === 'number'
    ? `number:${value}`
    : isWorkspaceLinkValue(value)
      ? `link:${value.label}\u0000${value.url}`
      : `text:${value}`;

const workspaceValueCollator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
const compareWorkspaceCellValues = (left: WorkspaceCellValue, right: WorkspaceCellValue, inputType?: WorkspaceInputType) => workspaceValueCollator.compare(searchableWorkspaceCellValue(left, inputType), searchableWorkspaceCellValue(right, inputType));

const updateTable = (data: WorkspaceData, tableId: string, updater: (table: WorkspaceTable) => WorkspaceTable): WorkspaceData => ({
  ...data,
  tables: data.tables.map((table) => table.id === tableId ? updater(table) : table),
});

const findTableNode = (data: WorkspaceData, tableId: string) => data.nodes.find((node) => node.type === 'table' && node.tableId === tableId);

const workspaceCellPadding = 40;
const workspaceMinColumnWidth = 40;
const workspaceMaxTextScale = 2.5;
const expandedFoldersStorageKey = 'board-game-helper-workspace-expanded-folders';
const tableReorderHoldMs = 420;

type TableReorderKind = 'row' | 'column';
type TableReorderVisual = { kind: TableReorderKind; sourceId: string; targetId: string; after: boolean };
type TableReorderSession = TableReorderVisual & { pointerId: number; startX: number; startY: number; active: boolean; timer?: number };
type HeaderFilterTarget = { axis: 'column' | 'row'; id: string; label: string };
type HeaderFilterState = { includedKeys: string[] | null; sort: 'asc' | 'desc' | null };
type HeaderFilterOption = { key: string; label: string };

const reorderBeforeOrAfter = <Item extends { id: string }>(items: Item[], sourceId: string, targetId: string, after: boolean) => {
  if (sourceId === targetId) return items;
  const source = items.find((item) => item.id === sourceId);
  if (!source) return items;
  const next = items.filter((item) => item.id !== sourceId);
  const targetIndex = next.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return items;
  next.splice(targetIndex + (after ? 1 : 0), 0, source);
  return next;
};

const measureWorkspaceText = (text: string, fontSize: number, fontWeight: number) => {
  if (typeof document === 'undefined') return Math.max(fontSize, text.length * fontSize);
  if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator.userAgent)) return Math.max(fontSize, text.length * fontSize);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return Math.max(fontSize, text.length * fontSize);
  context.font = `${fontWeight} ${fontSize}px "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif`;
  return Math.max(...text.split('\n').map((line) => context.measureText(line || 'M').width));
};

const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, forwardedRef) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(42, textarea.scrollHeight)}px`;
  }, []);
  useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement, []);
  useLayoutEffect(() => { resize(); }, [props.value, resize]);
  return <textarea {...props} ref={textareaRef} rows={1} onInput={(event) => { resize(); props.onInput?.(event); }} />;
});
AutoGrowTextarea.displayName = 'AutoGrowTextarea';

const dateTimeLocalValue = (value: WorkspaceCellValue) => {
  const source = normalizeWorkspaceDateTime(value) ? new Date(normalizeWorkspaceDateTime(value)!) : new Date();
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${source.getFullYear()}-${pad(source.getMonth() + 1)}-${pad(source.getDate())}T${pad(source.getHours())}:${pad(source.getMinutes())}`;
};

interface CellInputDialogProps {
  column: WorkspaceColumn;
  value: WorkspaceCellValue;
  inputLabel?: string;
  onDelete?(): void;
  onSave(value: string): void;
}

const CellInputDialog = ({ column, value, inputLabel, onDelete, onSave }: CellInputDialogProps) => {
  const [draft, setDraft] = useState(column.inputType === 'datetime' ? dateTimeLocalValue(value) : displayWorkspaceCellValue(value, column.inputType));
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    input?.focus();
    if (input instanceof HTMLInputElement) input.select();
    else input?.setSelectionRange(0, input.value.length);
  }, []);

  const commit = () => onSave(draft);
  return <WorkspaceModal title={column.name} onClose={commit} className="workspace-value-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
    {column.inputType === 'datetime'
      ? <input ref={inputRef as React.RefObject<HTMLInputElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input" type="datetime-local" value={draft} onChange={(event) => setDraft(event.target.value)} />
      : column.inputType === 'number'
      ? <input ref={inputRef as React.RefObject<HTMLInputElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input" type="number" inputMode="decimal" enterKeyHint="done" step="any" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
      : <AutoGrowTextarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} aria-label={inputLabel ?? `${column.name}輸入`} autoFocus className="workspace-value-input workspace-value-textarea" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); } }} />}
  </WorkspaceModal>;
};

const LinkInputDialog = ({ column, value, onDelete, onSave }: { column: WorkspaceColumn; value: WorkspaceCellValue; onDelete?(): void; onSave(value: WorkspaceLinkValue | null): void }) => {
  const initial = isWorkspaceLinkValue(value) ? value : { url: typeof value === 'string' ? value : '', label: '' };
  const [url, setUrl] = useState(initial.url);
  const [label, setLabel] = useState(initial.label);
  const commit = () => onSave(url.trim() || label.trim() ? { url: url.trim(), label: label.trim() } : null);
  return <WorkspaceModal title={column.name} onClose={commit} className="workspace-link-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
    <div className="workspace-link-fields">
      <label className="workspace-form-field">連結<input autoFocus type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
      <label className="workspace-form-field">顯示名稱<input type="text" inputMode="text" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
    </div>
  </WorkspaceModal>;
};

const overflowClassName = (column: WorkspaceColumn) => `workspace-overflow-${column.overflowMode ?? (column.inputType === 'link' ? 'ellipsis' : 'wrap')}`;

const ExternalLinkAction = ({ value }: { value: WorkspaceCellValue }) => {
  if (!isWorkspaceLinkValue(value)) return null;
  const href = externalHref(value.url);
  return href ? <a className="workspace-cell-external" href={href} target="_blank" rel="noreferrer" aria-label="外連" onClick={(event) => event.stopPropagation()}><WorkspaceIcon name="external" size={16} /></a> : null;
};

const WorkspaceHeaderContent = ({ label, nameClass, editLabel, filterActive, onFilter }: { label: string; nameClass: string; editLabel?: string; filterActive: boolean; onFilter(): void }) => <div className="workspace-header-layout">
  <button type="button" className={nameClass} aria-label={editLabel}>{label}</button>
  <button type="button" className={`workspace-header-filter ${filterActive ? 'active' : ''}`} aria-label={`篩選 ${label}`} aria-pressed={filterActive} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onFilter(); }}><WorkspaceIcon name="filter" size={14} /></button>
</div>;

const WorkspaceModal = ({ title, children, actions, leadingAction, onClose, className = '' }: { title: string; children: React.ReactNode; actions?: React.ReactNode; leadingAction?: React.ReactNode; onClose(): void; className?: string }) => {
  const [visualViewport, setVisualViewport] = useState<{ top: number; left: number; width: number; height: number }>();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const updateBounds = () => setVisualViewport({ top: viewport.offsetTop, left: viewport.offsetLeft, width: viewport.width, height: viewport.height });
    updateBounds();
    viewport.addEventListener('resize', updateBounds);
    viewport.addEventListener('scroll', updateBounds);
    return () => {
      viewport.removeEventListener('resize', updateBounds);
      viewport.removeEventListener('scroll', updateBounds);
    };
  }, []);
  const overlayStyle = visualViewport ? {
    top: `${visualViewport.top}px`,
    left: `${visualViewport.left}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${visualViewport.width}px`,
    height: `${visualViewport.height}px`,
    '--workspace-visual-viewport-height': `${visualViewport.height}px`,
  } as React.CSSProperties : undefined;
  return <div className={`workspace-overlay ${className ? `${className}-overlay` : ''}`} style={overlayStyle} role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`workspace-dialog ${leadingAction ? 'has-leading-action' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
      {leadingAction && <div className="workspace-dialog-leading-action">{leadingAction}</div>}
      <header className="workspace-dialog-heading"><h2 id="workspace-dialog-title">{title}</h2><button type="button" className="workspace-icon-button" onClick={onClose} aria-label="關閉"><WorkspaceIcon name="close" size={21} /></button></header>
      <div className="workspace-dialog-content">{children}</div>
      {actions && <footer className="workspace-dialog-actions">{actions}</footer>}
    </section>
  </div>;
};

const HeaderFilterDialog = ({ label, options, state, onClose, onSort, onToggle, onSelectAll, onClearAll }: { label: string; options: HeaderFilterOption[]; state: HeaderFilterState; onClose(): void; onSort(direction: 'asc' | 'desc'): void; onToggle(key: string): void; onSelectAll(): void; onClearAll(): void }) => {
  const [query, setQuery] = useState('');
  const visibleOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalized)) : options;
  }, [options, query]);
  const selected = state.includedKeys === null ? null : new Set(state.includedKeys);
  return <WorkspaceModal title={`篩選 ${label}`} onClose={onClose} className="workspace-filter-dialog">
    <div className="workspace-filter-sort" role="group" aria-label={`排序 ${label}`}>
      <button type="button" className={state.sort === 'asc' ? 'selected' : ''} onClick={() => onSort('asc')}><WorkspaceIcon name="up" size={18} />升冪</button>
      <button type="button" className={state.sort === 'desc' ? 'selected' : ''} onClick={() => onSort('desc')}><WorkspaceIcon name="down" size={18} />降冪</button>
    </div>
    <label className="workspace-filter-search"><WorkspaceIcon name="search" size={19} /><span className="sr-only">搜尋{label}的值</span><input type="search" aria-label={`搜尋${label}的值`} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="workspace-filter-selection-actions"><button type="button" onClick={onSelectAll}>全部</button><button type="button" onClick={onClearAll}>清除</button></div>
    <div className="workspace-filter-options" role="group" aria-label={`${label}篩選值`}>
      {visibleOptions.map((option) => <label key={option.key}><input type="checkbox" checked={selected === null || selected.has(option.key)} onChange={() => onToggle(option.key)} /><span>{option.label}</span></label>)}
      {!visibleOptions.length && <p>沒有符合的值</p>}
    </div>
  </WorkspaceModal>;
};

type NameDialogState = { mode: 'folder' | 'table' | 'row' | 'axis' | 'rename'; initialValue: string; parentId?: string | null; node?: WorkspaceNode; row?: WorkspaceRow; table?: WorkspaceTable };

const NameDialog = ({ state, onClose, onSubmit, onDelete }: { state: NameDialogState; onClose(): void; onSubmit(name: string): void; onDelete?(): void }) => {
  const [name, setName] = useState(state.initialValue);
  const isMultiline = state.mode === 'row' || state.mode === 'axis';
  const label = state.mode === 'folder' ? '資料夾名稱' : state.mode === 'table' ? '表格名稱' : state.mode === 'row' ? '項目名稱' : state.mode === 'axis' ? '項目軸名稱' : '名稱';
  const title = state.mode === 'folder' ? '新增資料夾' : state.mode === 'table' ? '新增表格' : state.mode === 'row' ? '編輯項目名稱' : state.mode === 'axis' ? '編輯項目軸' : '重新命名';
  const finish = () => { const value = name.trim(); if (value) onSubmit(value); else onClose(); };
  return <WorkspaceModal title={title} onClose={finish} className={isMultiline ? 'workspace-cell-name-dialog' : 'workspace-name-dialog'} leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
    <label className="workspace-form-field">{label}{isMultiline
      ? <AutoGrowTextarea autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(); } }} />
      : <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finish(); } }} />}</label>
  </WorkspaceModal>;
};

const ConfirmDialog = ({ title, message, onClose, onConfirm }: { title: string; message: string; onClose(): void; onConfirm(): void }) => <WorkspaceModal title={title} onClose={onClose} className="workspace-confirm-dialog" leadingAction={<button type="button" className="workspace-dialog-delete" onClick={onConfirm} aria-label="確認刪除"><WorkspaceIcon name="trash" size={20} /></button>}><p className="workspace-dialog-message">{message}</p></WorkspaceModal>;

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
  const submitQuery = () => {
    if (!normalizedQuery) return;
    const existingOption = options.find((option) => option.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase());
    choose(existingOption ?? normalizedQuery);
  };

  const finish = () => { if (isDynamic && normalizedQuery) submitQuery(); else onClose(); };
  return <WorkspaceModal title={column.name} onClose={finish} className="workspace-selection-dialog">
    {isDynamic && <label className="workspace-selection-search"><WorkspaceIcon name="search" size={20} /><span className="sr-only">搜尋或新增選項</span><input ref={inputRef} inputMode="text" enterKeyHint="done" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitQuery(); } }} placeholder="搜尋或輸入…" /><button type="button" onClick={() => setQuery('')} aria-label="清除搜尋"><WorkspaceIcon name="close" size={18} /></button></label>}
    <div className={`workspace-selection-list ${isDynamic ? 'with-search' : ''}`} role="listbox" aria-label={`${column.name}選項`}>
      {filtered.map((option, index) => <button ref={option === currentValue ? selectedOptionRef : undefined} type="button" key={`${index}-${option}`} role="option" aria-selected={option === currentValue} className={option === currentValue ? 'selected' : ''} onClick={() => choose(option)}>{option}</button>)}
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
  const moveOption = (index: number, direction: -1 | 1) => {
    const next = options.length ? [...options] : [''];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  };

  return <div className="workspace-option-list">
    {visibleOptions.map((option, index) => <div className="workspace-option-row" key={index}>
      <AutoGrowTextarea value={option} aria-label={`固定選項 ${index + 1}`} placeholder={`選項 ${index + 1}`} onChange={(event) => updateOption(index, event.target.value)} />
      <div className="workspace-option-controls">
        <button type="button" onClick={() => moveOption(index, -1)} disabled={index === 0} aria-label={`向上移動固定選項 ${index + 1}`}><WorkspaceIcon name="up" size={17} /></button>
        <button type="button" onClick={() => moveOption(index, 1)} disabled={index === visibleOptions.length - 1} aria-label={`向下移動固定選項 ${index + 1}`}><WorkspaceIcon name="down" size={17} /></button>
        <button type="button" className="workspace-option-remove" onClick={() => removeOption(index)} aria-label={`移除固定選項 ${index + 1}`}><WorkspaceIcon name="close" size={18} /></button>
      </div>
    </div>)}
    <button type="button" className="workspace-option-add" onClick={addOption}><WorkspaceIcon name="plus" size={18} />新增選項</button>
  </div>;
};

const ColumnConfig = ({ column, onSave, onDelete }: { column: WorkspaceColumn; onSave(column: WorkspaceColumn): void; onDelete?(): void }) => {
  const [draft, setDraft] = useState(column);
  const save = () => onSave({ ...draft, name: draft.name.trim() || '未命名欄位', options: draft.options.map((option) => option.trim()).filter(Boolean), overflowMode: draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap') });
  const category = inputCategoryFor(draft.inputType);
  const chooseInputCategory = (nextCategory: WorkspaceInputCategory) => setDraft((current) => {
    const currentCategory = inputCategoryFor(current.inputType);
    const nextType = currentCategory === nextCategory ? current.inputType : defaultInputTypeFor(nextCategory);
    return { ...current, inputType: nextType, overflowMode: nextType === 'link' && current.overflowMode === 'wrap' ? 'ellipsis' : current.overflowMode };
  });
  const chooseInputSubtype = (inputType: WorkspaceInputType) => setDraft((current) => ({ ...current, inputType, overflowMode: inputType === 'link' && current.overflowMode === 'wrap' ? 'ellipsis' : current.overflowMode }));
  return <WorkspaceModal title="欄位設定" onClose={save} className="workspace-column-dialog" leadingAction={onDelete && <button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除欄位"><WorkspaceIcon name="trash" size={20} /></button>}>
    <div className="workspace-column-config">
      <div className="workspace-column-config-rail">
        <label className="workspace-form-field">欄位名稱<AutoGrowTextarea value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <fieldset className="workspace-form-field workspace-input-type-field"><legend>輸入類型</legend><div className="workspace-input-type-options">{(Object.entries(inputCategoryLabels) as Array<[WorkspaceInputCategory, string]>).map(([value, label]) => <button type="button" key={value} className={category === value ? 'selected' : ''} onClick={() => chooseInputCategory(value)}>{label}</button>)}</div></fieldset>
        <fieldset className="workspace-form-field workspace-input-subtype-field"><legend>{inputCategoryLabels[category]}</legend><div className="workspace-input-subtype-options">{inputSubtypeLabels[category].map(({ value, label }) => <button type="button" key={value} className={draft.inputType === value ? 'selected' : ''} onClick={() => chooseInputSubtype(value)}>{label}</button>)}</div></fieldset>
        <fieldset className="workspace-form-field workspace-alignment-field"><legend>文字位置</legend><div className="workspace-alignment-options">{(['left', 'center', 'right'] as WorkspaceTextAlign[]).map((alignment) => <button type="button" key={alignment} className={(draft.alignment ?? 'left') === alignment ? 'selected' : ''} onClick={() => setDraft((current) => ({ ...current, alignment }))} aria-label={alignment === 'left' ? '置左' : alignment === 'center' ? '置中' : '置右'}><WorkspaceIcon name={alignment === 'left' ? 'align-left' : alignment === 'center' ? 'align-center' : 'align-right'} size={19} /></button>)}</div></fieldset>
        <fieldset className="workspace-form-field workspace-overflow-field"><legend>內容顯示</legend><div className="workspace-overflow-options">{(Object.entries(overflowModeLabels) as Array<[WorkspaceOverflowMode, string]>).map(([mode, label]) => <button type="button" key={mode} className={(draft.overflowMode ?? (draft.inputType === 'link' ? 'ellipsis' : 'wrap')) === mode ? 'selected' : ''} onClick={() => setDraft((current) => ({ ...current, overflowMode: mode }))}>{label}</button>)}</div></fieldset>
      </div>
      <div className="workspace-column-config-panel">
        {draft.inputType === 'select' && <SelectionOptionsEditor options={draft.options} onChange={(options) => setDraft((current) => ({ ...current, options }))} />}
      </div>
    </div>
  </WorkspaceModal>;
};

interface TreeNodeProps {
  node: WorkspaceNode;
  data: WorkspaceData;
  expanded: Set<string>;
  depth: number;
  draggingId?: string;
  dragTargetId?: string | null;
  onToggle(id: string): void;
  onOpen(node: WorkspaceNode): void;
  onContext(node: WorkspaceNode): void;
  onDragPointerDown(node: WorkspaceNode, event: React.PointerEvent<HTMLDivElement>): void;
  shouldSuppressClick(): boolean;
}

const TreeNode = ({ node, data, expanded, depth, draggingId, dragTargetId, onToggle, onOpen, onContext, onDragPointerDown, shouldSuppressClick }: TreeNodeProps) => {
  const children = node.type === 'folder' ? getChildren(data, node.id) : [];
  const isOpen = expanded.has(node.id);
  return <div className="workspace-tree-item">
    <div data-node-id={node.id} data-node-type={node.type} className={`workspace-tree-row ${data.activeNodeId === node.id ? 'active' : ''} ${draggingId === node.id ? 'is-dragging' : ''} ${dragTargetId === node.id ? 'is-drop-target' : ''}`} style={{ '--workspace-depth': depth } as React.CSSProperties} onPointerDown={(event) => onDragPointerDown(node, event)} onContextMenu={(event) => { event.preventDefault(); onContext(node); }} onClick={(event) => { if (shouldSuppressClick()) { event.preventDefault(); return; } if (node.type === 'folder') onToggle(node.id); else onOpen(node); }}>
      {node.type === 'folder' ? <span className={`workspace-tree-toggle ${isOpen ? 'open' : ''}`} aria-hidden="true"><WorkspaceIcon name="chevron" size={17} /></span> : <span className="workspace-tree-spacer" />}
      <span className="workspace-tree-name"><WorkspaceIcon name={node.type === 'folder' ? 'folder' : 'table'} size={19} /><span className="workspace-tree-name-text">{node.name}</span></span>
      <button type="button" className="workspace-tree-more" aria-label={`開啟${node.name}操作`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onContext(node); }}><WorkspaceIcon name="more" size={19} /></button>
    </div>
    {node.type === 'folder' && isOpen && <div className="workspace-tree-children">{children.map((child) => <TreeNode key={child.id} node={child} data={data} expanded={expanded} depth={depth + 1} draggingId={draggingId} dragTargetId={dragTargetId} onToggle={onToggle} onOpen={onOpen} onContext={onContext} onDragPointerDown={onDragPointerDown} shouldSuppressClick={shouldSuppressClick} />)}</div>}
  </div>;
};

const Tree = ({ data, expanded, onToggle, onOpen, onContext, onMove }: { data: WorkspaceData; expanded: Set<string>; onToggle(id: string): void; onOpen(node: WorkspaceNode): void; onContext(node: WorkspaceNode): void; onMove(node: WorkspaceNode, parentId: string | null): void }) => {
  const treeRef = useRef<HTMLDivElement>(null);
  const autoScrollFrame = useRef<number | undefined>(undefined);
  const autoScrollVelocity = useRef(0);
  const dragSession = useRef<{ node: WorkspaceNode; pointerId: number; startX: number; startY: number; timer?: number; active: boolean } | undefined>(undefined);
  const dragTargetRef = useRef<string | null>(null);
  const suppressNextClick = useRef(false);
  const [draggingNode, setDraggingNode] = useState<WorkspaceNode>();
  const [dragTargetId, setDragTargetId] = useState<string | null>();
  const [dragPoint, setDragPoint] = useState({ x: 0, y: 0 });
  const stopAutoScroll = () => {
    autoScrollVelocity.current = 0;
    if (autoScrollFrame.current !== undefined) window.cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = undefined;
  };
  const runAutoScroll = () => {
    const tree = treeRef.current;
    if (!tree || autoScrollVelocity.current === 0) { autoScrollFrame.current = undefined; return; }
    const next = Math.max(0, Math.min(tree.scrollHeight - tree.clientHeight, tree.scrollTop + autoScrollVelocity.current));
    tree.scrollTop = next;
    autoScrollFrame.current = window.requestAnimationFrame(runAutoScroll);
  };
  const updateAutoScroll = (clientY: number) => {
    const tree = treeRef.current;
    if (!tree) return;
    const rect = tree.getBoundingClientRect();
    const edge = Math.min(64, rect.height / 3);
    const velocity = clientY < rect.top + edge
      ? -Math.max(3, (rect.top + edge - clientY) / 3)
      : clientY > rect.bottom - edge
        ? Math.max(3, (clientY - (rect.bottom - edge)) / 3)
        : 0;
    autoScrollVelocity.current = velocity;
    if (velocity === 0) stopAutoScroll();
    else if (autoScrollFrame.current === undefined) autoScrollFrame.current = window.requestAnimationFrame(runAutoScroll);
  };
  const isInsideNode = (candidateId: string, ancestorId: string) => {
    let current = data.nodes.find((item) => item.id === candidateId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = data.nodes.find((item) => item.id === current?.parentId);
    }
    return false;
  };
  const clearDrag = () => {
    const session = dragSession.current;
    if (session?.timer) window.clearTimeout(session.timer);
    stopAutoScroll();
    dragSession.current = undefined;
    dragTargetRef.current = null;
    setDraggingNode(undefined);
    setDragTargetId(undefined);
  };
  useEffect(() => () => {
    if (dragSession.current?.timer) window.clearTimeout(dragSession.current.timer);
    stopAutoScroll();
  }, []);
  const beginDrag = (node: WorkspaceNode, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const session = { node, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, timer: undefined as number | undefined };
    session.timer = window.setTimeout(() => {
      session.active = true;
      suppressNextClick.current = true;
      setDraggingNode(node);
      setDragPoint({ x: session.startX, y: session.startY });
      try { treeRef.current?.setPointerCapture(session.pointerId); } catch { /* The pointer may have ended before the long press. */ }
    }, 460);
    dragSession.current = session;
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.active) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > 8) clearDrag();
      return;
    }
    event.preventDefault();
    setDragPoint({ x: event.clientX, y: event.clientY });
    updateAutoScroll(event.clientY);
    const targetRow = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>('.workspace-tree-row[data-node-id]');
    const targetId = targetRow?.dataset.nodeType === 'folder' ? targetRow.dataset.nodeId : undefined;
    const nextTarget = targetId && targetId !== session.node.id && !isInsideNode(targetId, session.node.id) ? targetId : null;
    dragTargetRef.current = nextTarget;
    setDragTargetId(nextTarget);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.active) onMove(session.node, dragTargetRef.current);
    try { if (treeRef.current?.hasPointerCapture(event.pointerId)) treeRef.current.releasePointerCapture(event.pointerId); } catch { /* Pointer capture may already be released. */ }
    clearDrag();
  };
  const shouldSuppressClick = () => {
    if (!suppressNextClick.current) return false;
    suppressNextClick.current = false;
    return true;
  };
  return <div ref={treeRef} className={`workspace-tree ${draggingNode && dragTargetId === null ? 'is-root-drop-target' : ''}`} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    {getChildren(data, null).map((node) => <TreeNode key={node.id} node={node} data={data} expanded={expanded} depth={0} draggingId={draggingNode?.id} dragTargetId={dragTargetId} onToggle={onToggle} onOpen={onOpen} onContext={onContext} onDragPointerDown={beginDrag} shouldSuppressClick={shouldSuppressClick} />)}
    {!data.nodes.some((node) => node.parentId === null) && <p className="workspace-tree-empty">尚未建立資料夾或表格</p>}
    {draggingNode && <div className="workspace-drag-ghost" style={{ transform: `translate(${dragPoint.x + 12}px, ${dragPoint.y + 12}px)` }}><WorkspaceIcon name={draggingNode.type === 'folder' ? 'folder' : 'table'} size={18} />{draggingNode.name}</div>}
  </div>;
};

const NodeActionsDialog = ({ node, onClose, onRename, onDelete, onAddFolder, onAddTable, onMove }: { node: WorkspaceNode; onClose(): void; onRename(): void; onDelete(): void; onAddFolder(): void; onAddTable(): void; onMove(): void }) => <WorkspaceModal title={node.name} onClose={onClose} className="workspace-action-dialog" leadingAction={<button type="button" className="workspace-dialog-delete" onClick={onDelete} aria-label="刪除"><WorkspaceIcon name="trash" size={20} /></button>}>
  <div className="workspace-action-list">
    {node.type === 'folder' && <><button type="button" onClick={onAddTable}><WorkspaceIcon name="table" size={21} />在此新增表格</button><button type="button" onClick={onAddFolder}><WorkspaceIcon name="folder" size={21} />在此新增資料夾</button></>}
    <button type="button" onClick={onRename}><WorkspaceIcon name="edit" size={21} />重新命名</button>
    <button type="button" onClick={onMove}><WorkspaceIcon name="move" size={21} />移動至</button>
  </div>
</WorkspaceModal>;

const MoveNodeDialog = ({ node, data, onClose, onMove }: { node: WorkspaceNode; data: WorkspaceData; onClose(): void; onMove(parentId: string | null): void }) => {
  const invalidFolders = new Set<string>([node.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of data.nodes) if (item.parentId && invalidFolders.has(item.parentId) && !invalidFolders.has(item.id)) { invalidFolders.add(item.id); changed = true; }
  }
  const folders = data.nodes.filter((item) => item.type === 'folder' && !invalidFolders.has(item.id));
  return <WorkspaceModal title={`移動「${node.name}」`} onClose={onClose} className="workspace-action-dialog"><div className="workspace-action-list workspace-move-list"><button type="button" onClick={() => onMove(null)}><WorkspaceIcon name="home" size={21} />最外層</button>{folders.map((folder) => <button type="button" key={folder.id} onClick={() => onMove(folder.id)}><WorkspaceIcon name="folder" size={21} />{folder.name}</button>)}</div></WorkspaceModal>;
};

const TableActionsDialog = ({ tableName, transposed, onClose, onExport, onSearch, onTranspose }: { tableName: string; transposed: boolean; onClose(): void; onExport(): void; onSearch(): void; onTranspose(): void }) => <WorkspaceModal title={tableName} onClose={onClose} className="workspace-action-dialog">
  <div className="workspace-action-list">
    <button type="button" onClick={onSearch}><WorkspaceIcon name="search" size={21} />搜尋此表</button>
    <button type="button" onClick={onTranspose}><WorkspaceIcon name="refresh" size={21} />{transposed ? '恢復正常顯示' : '轉置顯示'}</button>
    <button type="button" onClick={onExport}><WorkspaceIcon name="download" size={21} />匯出此表</button>
  </div>
</WorkspaceModal>;

const TableCreateDialog = ({ onClose, onCreate, onImport }: { onClose(): void; onCreate(): void; onImport(): void }) => <WorkspaceModal title="新增表格" onClose={onClose} className="workspace-action-dialog">
  <div className="workspace-action-list">
    <button type="button" onClick={onCreate}><WorkspaceIcon name="table-plus" size={21} />建立空白表格</button>
    <button type="button" onClick={onImport}><WorkspaceIcon name="upload" size={21} />匯入單表</button>
  </div>
</WorkspaceModal>;

const WorkspacePage = () => {
  const [data, setData] = useState<WorkspaceData>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rowId: string; columnId: string }>();
  const [selectionEditor, setSelectionEditor] = useState<{ rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean }>();
  const [configuring, setConfiguring] = useState<{ column: WorkspaceColumn; isRowHeader: boolean }>();
  const [workspaceImport, setWorkspaceImport] = useState<WorkspaceData>();
  const [nodeMenu, setNodeMenu] = useState<WorkspaceNode>();
  const [movingNode, setMovingNode] = useState<WorkspaceNode>();
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [headerFilters, setHeaderFilters] = useState<Record<string, HeaderFilterState>>({});
  const [filterTarget, setFilterTarget] = useState<HeaderFilterTarget>();
  const [tableCreateParentId, setTableCreateParentId] = useState<string | null | undefined>(undefined);
  const [nameDialog, setNameDialog] = useState<NameDialogState>();
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm(): void }>();
  const [notice, setNotice] = useState('');
  const [textScale, setTextScale] = useState(1);
  const [minTextScale, setMinTextScale] = useState(0.35);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [panning, setPanning] = useState(false);
  const [tableReorderVisual, setTableReorderVisual] = useState<TableReorderVisual>();
  const dataRef = useRef<WorkspaceData | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement>(null);
  const workspacePageRef = useRef<HTMLElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | undefined>(undefined);
  const panStart = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | undefined>(undefined);
  const pointerMoved = useRef(false);
  const ignoreNextTableClick = useRef(false);
  const tableReorderSession = useRef<TableReorderSession | undefined>(undefined);
  const importTableInputRef = useRef<HTMLInputElement>(null);
  const importWorkspaceInputRef = useRef<HTMLInputElement>(null);
  const importTableParentId = useRef<string | null>(null);
  const textScaleRef = useRef(1);
  const applyTextScaleRef = useRef<((scale: number, persist?: boolean) => void) | undefined>(undefined);
  const pendingScaleSave = useRef<{ tableId: string; scale: number } | undefined>(undefined);
  const scaleSaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current);
    if (tableReorderSession.current?.timer) window.clearTimeout(tableReorderSession.current.timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const reload = useCallback(async () => {
    const loaded = await loadWorkspace();
    dataRef.current = loaded;
    setData(loaded);
    const folderIds = new Set(loaded.nodes.filter((node) => node.type === 'folder').map((node) => node.id));
    let restored = new Set(folderIds);
    try {
      const stored = window.localStorage.getItem(expandedFoldersStorageKey);
      if (stored !== null) restored = new Set((JSON.parse(stored) as unknown[]).filter((id): id is string => typeof id === 'string' && folderIds.has(id)));
    } catch { /* Ignore damaged UI preferences. */ }
    let current = loaded.nodes.find((node) => node.id === loaded.activeNodeId);
    while (current?.parentId) {
      restored.add(current.parentId);
      current = loaded.nodes.find((node) => node.id === current?.parentId);
    }
    setExpanded(restored);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const commit = useCallback((next: WorkspaceData) => {
    dataRef.current = next;
    setData(next);
    void saveWorkspace(next).catch(() => setNotice('本機儲存失敗，請先匯出資料備份'));
  }, []);
  const table = useMemo(() => data ? getTableForNode(data, data.activeNodeId) : undefined, [data]);
  const tableNode = useMemo(() => table && data ? findTableNode(data, table.id) : undefined, [data, table]);
  const rowHeader = useMemo(() => table ? getRowHeaderColumn(table) : undefined, [table]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchedRows = useMemo(() => {
    if (!table) return [];
    const query = deferredSearchQuery.trim().toLocaleLowerCase();
    if (!query) return table.rows;
    return table.rows.filter((row) => [
      { value: row.name, inputType: rowHeader?.inputType },
      ...table.columns.map((column) => ({ value: row.values[column.id] ?? null, inputType: column.inputType })),
    ].some(({ value, inputType }) => searchableWorkspaceCellValue(value, inputType).toLocaleLowerCase().includes(query)));
  }, [deferredSearchQuery, rowHeader, table]);
  const filteredRows = useMemo(() => {
    if (!table || !rowHeader) return [];
    const columnIds = new Set([rowHeader.id, ...table.columns.map((column) => column.id)]);
    const columnFilters = Object.entries(headerFilters).filter(([key, state]) => key.startsWith('column:') && columnIds.has(key.slice(7)) && state.includedKeys !== null);
    const rows = searchedRows.filter((row) => columnFilters.every(([key, state]) => {
      const columnId = key.slice(7);
      const value = columnId === rowHeader.id ? row.name : row.values[columnId] ?? null;
      return state.includedKeys!.includes(workspaceFilterValueKey(value));
    }));
    const sortedEntry = Object.entries(headerFilters).find(([key, state]) => key.startsWith('column:') && columnIds.has(key.slice(7)) && state.sort);
    if (!sortedEntry) return rows;
    const [key, state] = sortedEntry;
    const columnId = key.slice(7);
    const direction = state.sort === 'desc' ? -1 : 1;
    return rows.map((row, index) => ({ row, index })).sort((left, right) => {
      const leftValue = columnId === rowHeader.id ? left.row.name : left.row.values[columnId] ?? null;
      const rightValue = columnId === rowHeader.id ? right.row.name : right.row.values[columnId] ?? null;
      const inputType = columnId === rowHeader.id ? rowHeader.inputType : table.columns.find((column) => column.id === columnId)?.inputType;
      return compareWorkspaceCellValues(leftValue, rightValue, inputType) * direction || left.index - right.index;
    }).map(({ row }) => row);
  }, [headerFilters, rowHeader, searchedRows, table]);
  const tableRowsById = useMemo(() => new Map(table?.rows.map((row) => [row.id, row]) ?? []), [table]);
  const visibleColumns = useMemo(() => {
    if (!table) return [];
    const visibleRowIds = new Set(filteredRows.map((row) => row.id));
    const rowFilters = Object.entries(headerFilters).filter(([key, state]) => key.startsWith('row:') && visibleRowIds.has(key.slice(4)) && state.includedKeys !== null);
    const columns = table.columns.filter((column) => rowFilters.every(([key, state]) => {
      const row = tableRowsById.get(key.slice(4));
      return Boolean(row && state.includedKeys!.includes(workspaceFilterValueKey(row.values[column.id] ?? null)));
    }));
    const sortedEntry = Object.entries(headerFilters).find(([key, state]) => key.startsWith('row:') && visibleRowIds.has(key.slice(4)) && state.sort);
    if (!sortedEntry) return columns;
    const [key, state] = sortedEntry;
    const row = tableRowsById.get(key.slice(4));
    if (!row) return columns;
    const direction = state.sort === 'desc' ? -1 : 1;
    return columns.map((column, index) => ({ column, index })).sort((left, right) => compareWorkspaceCellValues(row.values[left.column.id] ?? null, row.values[right.column.id] ?? null, left.column.inputType) * direction || left.index - right.index).map(({ column }) => column);
  }, [filteredRows, headerFilters, table, tableRowsById]);
  useEffect(() => {
    const nextScale = table?.textScale ?? 1;
    textScaleRef.current = nextScale;
    setTextScale(nextScale);
  }, [table?.id]);
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setHeaderFilters({});
    setFilterTarget(undefined);
  }, [table?.id]);
  useEffect(() => {
    if (!data) return;
    window.localStorage.setItem(expandedFoldersStorageKey, JSON.stringify([...expanded]));
  }, [data, expanded]);
  const activeFilterKey = filterTarget ? `${filterTarget.axis}:${filterTarget.id}` : '';
  const activeFilterState = headerFilters[activeFilterKey] ?? { includedKeys: null, sort: null };
  const activeFilterOptions = useMemo(() => {
    if (!table || !rowHeader || !filterTarget) return [];
    const values = filterTarget.axis === 'column'
      ? table.rows.map((row) => ({ value: filterTarget.id === rowHeader.id ? row.name : row.values[filterTarget.id] ?? null, inputType: filterTarget.id === rowHeader.id ? rowHeader.inputType : table.columns.find((column) => column.id === filterTarget.id)?.inputType }))
      : table.columns.map((column) => ({ value: tableRowsById.get(filterTarget.id)?.values[column.id] ?? null, inputType: column.inputType }));
    const unique = new Map<string, HeaderFilterOption>();
    for (const { value, inputType } of values) {
      const key = workspaceFilterValueKey(value);
      if (!unique.has(key)) unique.set(key, { key, label: displayWorkspaceCellValue(value, inputType) || '（空白）' });
    }
    return [...unique.values()].sort((left, right) => workspaceValueCollator.compare(left.label, right.label));
  }, [filterTarget, rowHeader, table, tableRowsById]);
  const updateActiveFilter = (updater: (state: HeaderFilterState) => HeaderFilterState) => {
    if (!activeFilterKey) return;
    setHeaderFilters((current) => ({ ...current, [activeFilterKey]: updater(current[activeFilterKey] ?? { includedKeys: null, sort: null }) }));
  };
  const setActiveFilterSort = (direction: 'asc' | 'desc') => {
    if (!activeFilterKey) return;
    setHeaderFilters((current) => {
      const next = Object.fromEntries(Object.entries(current).map(([key, state]) => [key, { ...state, sort: null }])) as Record<string, HeaderFilterState>;
      const state = current[activeFilterKey] ?? { includedKeys: null, sort: null };
      next[activeFilterKey] = { ...state, sort: state.sort === direction ? null : direction };
      return next;
    });
  };
  const toggleActiveFilterOption = (key: string) => updateActiveFilter((state) => {
    const selected = state.includedKeys === null ? new Set(activeFilterOptions.map((option) => option.key)) : new Set(state.includedKeys);
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    return { ...state, includedKeys: selected.size === activeFilterOptions.length ? null : [...selected] };
  });
  const isHeaderFilterActive = (axis: HeaderFilterTarget['axis'], id: string) => {
    const state = headerFilters[`${axis}:${id}`];
    return Boolean(state && (state.includedKeys !== null || state.sort));
  };
  const columnTextWidths = useMemo(() => {
    if (!table || !rowHeader) return [];
    const widthFor = (column: WorkspaceColumn, values: WorkspaceCellValue[]) => Math.max(
      measureWorkspaceText(column.name, 20, 600),
      ...(column.overflowMode === 'expand' ? values.map((value) => measureWorkspaceText(displayWorkspaceCellValue(value, column.inputType), 20, 400)) : []),
    ) + (column.inputType === 'link' ? 46 : 0);
    if (!table.transposed) return [widthFor(rowHeader, table.rows.map((row) => row.name)), ...table.columns.map((column) => widthFor(column, table.rows.map((row) => row.values[column.id] ?? null)))];
    const properties = [rowHeader, ...visibleColumns];
    const propertyWidth = Math.max(...properties.map((column) => measureWorkspaceText(column.name, 20, 600)));
    const rowWidths = filteredRows.map((row) => Math.max(
      measureWorkspaceText(displayWorkspaceCellValue(row.name, rowHeader.inputType), 20, 600),
      ...properties.map((column) => column.overflowMode === 'expand'
        ? measureWorkspaceText(displayWorkspaceCellValue(column.id === rowHeader.id ? row.name : row.values[column.id] ?? null, column.inputType), 20, 400) + (column.inputType === 'link' ? 46 : 0)
        : 0),
    ));
    return [propertyWidth, ...rowWidths];
  }, [filteredRows, rowHeader, table, visibleColumns]);
  const naturalColumnWidths = useMemo(() => columnTextWidths.map((textWidth) => Math.max(workspaceMinColumnWidth, textWidth * textScale + workspaceCellPadding)), [columnTextWidths, textScale]);
  const naturalTableWidth = naturalColumnWidths.reduce((total, width) => total + width, 0);
  const fillRatio = viewportWidth && naturalTableWidth < viewportWidth ? viewportWidth / naturalTableWidth : 1;
  const columnWidths = naturalColumnWidths.map((width) => width * fillRatio);
  const tableWidth = Math.max(viewportWidth, naturalTableWidth);

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
    const widthAt = (scale: number) => columnTextWidths.reduce((total, width) => total + Math.max(workspaceMinColumnWidth, width * scale + workspaceCellPadding), 0);
    if (widthAt(1) <= viewportWidth) { setMinTextScale(1); return; }
    if (widthAt(0.1) >= viewportWidth) { setMinTextScale(0.1); return; }
    let low = 0.1;
    let high = 1;
    for (let index = 0; index < 20; index += 1) {
      const middle = (low + high) / 2;
      if (widthAt(middle) <= viewportWidth) low = middle; else high = middle;
    }
    setMinTextScale(low);
  }, [columnTextWidths, viewportWidth]);

  useEffect(() => {
    setTextScale((current) => {
      const next = Math.max(minTextScale, Math.min(workspaceMaxTextScale, current));
      textScaleRef.current = next;
      return next;
    });
  }, [minTextScale]);

  const openNameDialog = (mode: NameDialogState['mode'], initialValue: string, parentId?: string | null, node?: WorkspaceNode) => setNameDialog({ mode, initialValue, parentId, node });
  const addFolder = (parentId: string | null) => openNameDialog('folder', '', parentId);
  const addTable = (parentId: string | null) => openNameDialog('table', '', parentId);
  const renameNode = (node: WorkspaceNode) => openNameDialog('rename', node.name, undefined, node);
  const renameRow = (row: WorkspaceRow) => setNameDialog({ mode: 'row', initialValue: displayWorkspaceCellValue(row.name, rowHeader?.inputType), row });
  const renameRowHeader = (currentTable: WorkspaceTable) => setNameDialog({ mode: 'axis', initialValue: getRowHeaderColumn(currentTable).name, table: currentTable });

  const submitName = (name: string) => {
    if (!data || !nameDialog) return;
    if (nameDialog.mode === 'folder' || nameDialog.mode === 'table') {
      const parentId = nameDialog.parentId ?? null;
      if (nameDialog.mode === 'folder') {
        const node = createNode('folder', name, parentId, getChildren(data, parentId).length);
        commit({ ...data, nodes: [...data.nodes, node] });
        setExpanded((current) => { const next = new Set(current); if (parentId) next.add(parentId); else next.add(node.id); return next; });
      } else {
        const currentTable = createTable(name);
        const node = createNode('table', currentTable.name, parentId, getChildren(data, parentId).length, currentTable.id);
        commit({ ...data, tables: [...data.tables, currentTable], nodes: [...data.nodes, node], activeNodeId: node.id });
        if (parentId) setExpanded((current) => new Set(current).add(parentId));
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

  const askDeleteNode = (node: WorkspaceNode) => {
    setNodeMenu(undefined);
    setConfirmDialog({ title: '確認刪除', message: `確定要刪除「${node.name}」嗎？${node.type === 'folder' ? '資料夾內的內容也會一併刪除。' : ''}`, onConfirm: () => { if (data) commit(removeNodeAndDescendants(data, node.id)); setConfirmDialog(undefined); } });
  };
  const relocateNode = (node: WorkspaceNode, parentId: string | null) => {
    if (!data) return;
    const next = moveNode(data, node.id, parentId);
    if (next !== data) {
      commit(next);
      if (parentId) setExpanded((current) => new Set(current).add(parentId));
      setNotice(`已移動「${node.name}」`);
    }
    setMovingNode(undefined);
    setNodeMenu(undefined);
  };
  const openNode = (node: WorkspaceNode) => { if (!data) return; if (node.type === 'folder') { setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); return; } commit({ ...data, activeNodeId: node.id }); setEditing(undefined); setSelectionEditor(undefined); setDrawerOpen(false); setNodeMenu(undefined); };

  const saveCellValue = (rowId: string, column: WorkspaceColumn, value: WorkspaceCellValue) => {
    if (!data || !table) return;
    const isRowHeader = rowHeader?.id === column.id;
    commit(updateTable(data, table.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rows: current.rows.map((row) => row.id === rowId ? isRowHeader ? { ...row, name: value } : { ...row, values: { ...row.values, [column.id]: value } } : row),
    })));
    setEditing(undefined);
  };
  const updateCell = (rowId: string, column: WorkspaceColumn, raw: string) => {
    if (column.inputType === 'number' && raw.trim() && !Number.isFinite(Number(raw))) { setNotice('請輸入有效數字'); return; }
    const value: WorkspaceCellValue = column.inputType === 'datetime'
      ? normalizeWorkspaceDateTime(raw)
      : !raw.trim() ? null : column.inputType === 'number' ? Number(raw) : raw;
    if (column.inputType === 'datetime' && raw.trim() && !value) { setNotice('請輸入有效時間'); return; }
    saveCellValue(rowId, column, value);
  };
  const openCell = (row: WorkspaceRow, column: WorkspaceColumn) => {
    if (!table) return;
    const isRowHeader = rowHeader?.id === column.id;
    const value = isRowHeader ? row.name : row.values[column.id];
    if (column.inputType === 'select' || column.inputType === 'dynamic-select') {
      setEditing(undefined);
      setSelectionEditor({ rowId: row.id, column, value, options: column.inputType === 'dynamic-select' ? getDynamicOptions(table, column.id) : column.options, isRowHeader });
      return;
    }
    setEditing({ rowId: row.id, columnId: column.id });
  };
  const selectCellValue = (value: string) => {
    if (!selectionEditor) return;
    updateCell(selectionEditor.rowId, selectionEditor.column, value);
    setSelectionEditor(undefined);
  };
  const addRow = () => { if (!data || !table) return; commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: [...current.rows, createRow(current.columns, `項目 ${current.rows.length + 1}`)] }))); setTableActionsOpen(false); setNotice('已新增項目'); };
  const askDeleteRow = (row: WorkspaceRow, rowIndex: number) => setConfirmDialog({ title: '刪除項目', message: `確定要刪除「${displayWorkspaceCellValue(row.name, rowHeader?.inputType) || `項目 ${rowIndex + 1}`}」嗎？`, onConfirm: () => { if (data && table) commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.filter((item) => item.id !== row.id) }))); setConfirmDialog(undefined); } });
  const addColumn = () => { if (!data || !table) return; const column = createColumn(`欄位 ${table.columns.length + 1}`); commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: [...current.columns, column], rows: current.rows.map((row) => ({ ...row, values: { ...row.values, [column.id]: null } })) }))); setTableActionsOpen(false); setNotice('已新增屬性'); };
  const askDeleteColumn = (column: WorkspaceColumn) => setConfirmDialog({ title: '刪除欄位', message: `確定要刪除欄位「${column.name}」嗎？此欄的資料也會一併刪除。`, onConfirm: () => { if (data && table) commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: current.columns.filter((item) => item.id !== column.id), rows: current.rows.map((row) => { const values = { ...row.values }; delete values[column.id]; return { ...row, values }; }) }))); setConfirmDialog(undefined); } });
  const saveColumn = (column: WorkspaceColumn) => {
    if (!data || !table || !configuring) return;
    commit(updateTable(data, table.id, (current) => configuring.isRowHeader
      ? { ...current, updatedAt: Date.now(), rowHeaderName: column.name, rowHeader: column }
      : { ...current, updatedAt: Date.now(), columns: current.columns.map((item) => item.id === column.id ? column : item) }));
    setConfiguring(undefined);
  };

  const exportCurrent = () => { if (!data || !table) return; download(exportWorkspaceXlsx(data, table), `${fileBaseName(table.name)}.xlsx`); setTableActionsOpen(false); setNotice('已匯出目前表格'); };
  const exportAll = () => { if (!data) return; download(exportWorkspaceXlsx(data), 'workspace.xlsx'); setDrawerOpen(false); setNotice('已匯出整個資料庫'); };
  const chooseImport = (kind: 'table' | 'workspace') => {
    const input = kind === 'table' ? importTableInputRef.current : importWorkspaceInputRef.current;
    if (!input) { setNotice('無法開啟檔案選擇器'); return; }
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
      setTableActionsOpen(false);
      setTableCreateParentId(undefined);
      if (kind === 'workspace') setDrawerOpen(false);
    } catch {
      input.click();
      setTableActionsOpen(false);
      setTableCreateParentId(undefined);
      if (kind === 'workspace') setDrawerOpen(false);
    }
  };
  const readImport = async (file: File, kind: 'table' | 'workspace') => {
    setNotice(`正在匯入「${file.name}」…`);
    try {
      const imported = await importWorkspaceXlsx(file);
      if (kind === 'table') {
        if (imported.isWorkspace || !imported.table || !data) throw new Error('請選擇單張表格檔案');
        const tableCopy = imported.table;
        const parentId = importTableParentId.current;
        const node = createNode('table', tableCopy.name, parentId, getChildren(data, parentId).length, tableCopy.id);
        commit({ ...data, tables: [...data.tables, tableCopy], nodes: [...data.nodes, node], activeNodeId: node.id }); setNotice('單張表格已匯入'); setDrawerOpen(false);
      } else {
        if (!imported.isWorkspace || !imported.data || !data) throw new Error('請選擇整個資料庫檔案');
        setWorkspaceImport(imported.data);
      }
    } catch (error) {
      console.error('[workspace-import] failed', { kind, fileName: file.name, fileSize: file.size, error });
      setNotice(error instanceof Error ? `匯入失敗：${error.message}` : '匯入失敗');
    }
  };
  const finishWorkspaceImport = (mode: 'replace' | 'merge') => {
    if (!data || !workspaceImport) return;
    const next = mode === 'replace'
      ? { ...workspaceImport, activeNodeId: resolveActiveTableNodeId(workspaceImport) }
      : (() => {
        const copy = cloneImportedWorkspace(workspaceImport);
        const merged = { ...data, nodes: [...data.nodes, ...copy.nodes], tables: [...data.tables, ...copy.tables] };
        return { ...merged, activeNodeId: resolveActiveTableNodeId(merged, copy.nodes.find((node) => node.type === 'table')?.id) };
      })();
    commit(next); setWorkspaceImport(undefined); setNotice(mode === 'replace' ? '資料庫已取代' : '資料庫已合併');
  };

  const persistTextScale = (scale: number) => {
    const pending = pendingScaleSave.current;
    const currentData = dataRef.current;
    const tableId = pending?.tableId ?? table?.id;
    pendingScaleSave.current = undefined;
    if (!currentData || !tableId) return;
    const currentTable = currentData.tables.find((item) => item.id === tableId);
    if (!currentTable || Math.abs((currentTable.textScale ?? 1) - scale) < 0.001) return;
    commit(updateTable(currentData, tableId, (current) => ({ ...current, textScale: scale, updatedAt: Date.now() })));
  };

  const scheduleTextScaleSave = (scale: number) => {
    if (!table) return;
    pendingScaleSave.current = { tableId: table.id, scale };
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current);
    scaleSaveTimer.current = window.setTimeout(() => {
      scaleSaveTimer.current = undefined;
      persistTextScale(pendingScaleSave.current?.scale ?? scale);
    }, 180);
  };

  const applyTextScale = (scale: number, persist = true) => {
    const nextScale = Math.max(minTextScale, Math.min(workspaceMaxTextScale, scale));
    textScaleRef.current = nextScale;
    setTextScale(nextScale);
    if (persist) scheduleTextScaleSave(nextScale);
  };
  applyTextScaleRef.current = applyTextScale;

  useEffect(() => {
    const isInsideWorkspace = (target: EventTarget | null) => target instanceof Node && Boolean(workspacePageRef.current?.contains(target));
    const isInsideDialog = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.workspace-dialog'));
    const onWheelCapture = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !isInsideWorkspace(event.target)) return;
      event.preventDefault();
      if (isInsideDialog(event.target)) return;
      applyTextScaleRef.current?.(textScaleRef.current - event.deltaY * 0.002);
    };
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !['+', '=', '-', '_', '0'].includes(event.key) || !isInsideWorkspace(event.target)) return;
      event.preventDefault();
      if (isInsideDialog(event.target)) return;
      if (event.key === '0') {
        applyTextScaleRef.current?.(1);
        return;
      }
      applyTextScaleRef.current?.(textScaleRef.current + (event.key === '-' || event.key === '_' ? -0.1 : 0.1));
    };
    window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => {
      window.removeEventListener('wheel', onWheelCapture, true);
      window.removeEventListener('keydown', onKeyDownCapture, true);
    };
  }, []);

  const flushPendingTextScale = () => {
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current);
    scaleSaveTimer.current = undefined;
    const pending = pendingScaleSave.current;
    if (pending) persistTextScale(pending.scale);
  };

  const beginTableReorder = (kind: TableReorderKind, sourceId: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const session: TableReorderSession = { kind, sourceId, targetId: sourceId, after: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
    session.timer = window.setTimeout(() => {
      if (tableReorderSession.current !== session) return;
      session.active = true;
      pointers.current.clear();
      panStart.current = undefined;
      pinchStart.current = undefined;
      setPanning(false);
      setTableReorderVisual({ kind, sourceId, targetId: sourceId, after: false });
      const viewport = viewportRef.current;
      if (viewport && 'setPointerCapture' in viewport) {
        try { viewport.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
      }
    }, tableReorderHoldMs);
    tableReorderSession.current = session;
  };

  const moveTableReorder = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = tableReorderSession.current;
    if (!session || session.pointerId !== event.pointerId) return false;
    if (!session.active) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > 8) {
        if (session.timer) window.clearTimeout(session.timer);
        tableReorderSession.current = undefined;
      }
      return false;
    }
    const selector = session.kind === 'row' ? '[data-row-id]' : '[data-column-id]';
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(selector);
    const targetId = target?.dataset[session.kind === 'row' ? 'rowId' : 'columnId'];
    if (target && targetId) {
      const rect = target.getBoundingClientRect();
      session.targetId = targetId;
      const horizontal = table?.transposed ? session.kind === 'row' : session.kind === 'column';
      session.after = horizontal ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
      setTableReorderVisual({ kind: session.kind, sourceId: session.sourceId, targetId, after: session.after });
    }
    event.preventDefault();
    return true;
  };

  const endTableReorder = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = tableReorderSession.current;
    if (!session || session.pointerId !== event.pointerId) return false;
    if (session.timer) window.clearTimeout(session.timer);
    tableReorderSession.current = undefined;
    setTableReorderVisual(undefined);
    if (!session.active) return false;
    if (data && table && session.sourceId !== session.targetId) {
      commit(updateTable(data, table.id, (current) => ({
        ...current,
        updatedAt: Date.now(),
        ...(session.kind === 'row'
          ? { rows: reorderBeforeOrAfter(current.rows, session.sourceId, session.targetId, session.after) }
          : { columns: reorderBeforeOrAfter(current.columns, session.sourceId, session.targetId, session.after) }),
      })));
      setNotice(session.kind === 'row' ? '已調整項目順序' : '已調整屬性順序');
    }
    ignoreNextTableClick.current = true;
    window.setTimeout(() => { ignoreNextTableClick.current = false; }, 120);
    event.preventDefault();
    return true;
  };

  const beginTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest('input, textarea')) return;
    const viewport = event.currentTarget;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointerMoved.current = false;
    if (pointers.current.size === 1) {
      panStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
      pinchStart.current = undefined;
    } else if (pointers.current.size === 2) {
      const points = [...pointers.current.values()];
      if ('setPointerCapture' in viewport) {
        for (const pointerId of pointers.current.keys()) {
          try { viewport.setPointerCapture(pointerId); } catch { /* A pointer may already have been cancelled. */ }
        }
      }
      pinchStart.current = { distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)), scale: textScaleRef.current };
      panStart.current = undefined;
    }
  };

  const moveTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const viewport = event.currentTarget;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const points = [...pointers.current.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      pointerMoved.current = true;
      applyTextScale(pinchStart.current.scale * distance / pinchStart.current.distance, false);
      event.preventDefault();
    } else if (pointers.current.size === 1 && panStart.current?.pointerId === event.pointerId) {
      const deltaX = event.clientX - panStart.current.x;
      const deltaY = event.clientY - panStart.current.y;
      const dragThreshold = event.pointerType === 'touch' ? 10 : 4;
      if (!pointerMoved.current && Math.hypot(deltaX, deltaY) <= dragThreshold) return;
      if (!pointerMoved.current) {
        pointerMoved.current = true;
        setPanning(true);
        if ('setPointerCapture' in viewport) {
          try { viewport.setPointerCapture(event.pointerId); } catch { /* The pointer may already have been cancelled. */ }
        }
      }
      viewport.scrollLeft = panStart.current.scrollLeft - deltaX;
      viewport.scrollTop = panStart.current.scrollTop - deltaY;
      event.preventDefault();
    }
  };

  const endTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const viewport = event.currentTarget;
    const moved = pointerMoved.current;
    pointers.current.delete(event.pointerId);
    if ('hasPointerCapture' in viewport && viewport.hasPointerCapture(event.pointerId)) {
      try { viewport.releasePointerCapture(event.pointerId); } catch { /* The pointer may already have been cancelled. */ }
    }
    pinchStart.current = undefined;
    if (pointers.current.size === 1) {
      const [pointerId, point] = pointers.current.entries().next().value as [number, { x: number; y: number }];
      panStart.current = { pointerId, x: point.x, y: point.y, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    } else {
      panStart.current = undefined;
    }
    if (pointers.current.size === 0) {
      setPanning(false);
      if (moved) {
        ignoreNextTableClick.current = true;
        window.setTimeout(() => { ignoreNextTableClick.current = false; }, 0);
      }
      if (event.pointerType === 'touch') {
        pendingScaleSave.current = table ? { tableId: table.id, scale: textScaleRef.current } : undefined;
        flushPendingTextScale();
      }
    }
  };

  if (!data) return <section className="workspace-page workspace-loading"><p>正在開啟本地 Workspace…</p></section>;
  const activeEditingRow = editing && table ? table.rows.find((item) => item.id === editing.rowId) : undefined;
  const activeEditingRowIndex = activeEditingRow && table ? table.rows.findIndex((item) => item.id === activeEditingRow.id) : -1;
  const activeEditingColumn = editing && table ? editing.columnId === rowHeader?.id ? rowHeader : table.columns.find((item) => item.id === editing.columnId) : undefined;
  const activeEditingValue = activeEditingRow && activeEditingColumn ? activeEditingColumn.id === rowHeader?.id ? activeEditingRow.name : activeEditingRow.values[activeEditingColumn.id] : null;
  const activeCell = editing ?? (selectionEditor ? { rowId: selectionEditor.rowId, columnId: selectionEditor.column.id } : undefined);
  return <section ref={workspacePageRef} className="workspace-page" style={{ '--workspace-text-scale': textScale } as React.CSSProperties}>
    <h1 className="sr-only">動態表格</h1>
    <header className="workspace-appbar">
      <div className="workspace-appbar-leading"><button type="button" className="workspace-appbar-button workspace-menu-button" aria-label="開啟目錄" onClick={() => setDrawerOpen(true)}><WorkspaceIcon name="menu" size={29} /></button><button type="button" className={`workspace-appbar-title ${nameDialog?.node?.id === tableNode?.id ? 'is-editing' : ''}`} onClick={() => tableNode && renameNode(tableNode)} disabled={!tableNode} aria-label="重新命名表格"><span>{table?.name ?? '動態表格'}</span></button></div>
      <div className="workspace-appbar-actions">
        <button type="button" className="workspace-appbar-button" aria-label="新增屬性" onClick={addColumn} disabled={!table}><WorkspaceIcon name="columns" size={29} /></button>
        <button type="button" className={`workspace-appbar-button ${tableActionsOpen ? 'active' : ''}`} aria-label="設定" onClick={() => setTableActionsOpen(true)} disabled={!table}><WorkspaceIcon name="settings" size={29} /></button>
      </div>
    </header>
    {searchOpen && table && <div className="workspace-searchbar" role="search"><WorkspaceIcon name="search" size={21} /><input type="search" aria-label="搜尋此表" placeholder="搜尋此表" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus /><span className="workspace-search-count">顯示 {filteredRows.length} / {table.rows.length} 項</span><button type="button" aria-label="關閉搜尋" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}><WorkspaceIcon name="close" size={20} /></button></div>}
    {notice && <div className="workspace-notice" role="status">{notice}</div>}
    <div className={`workspace-body ${drawerOpen ? 'drawer-is-open' : ''}`}>
      <main className="workspace-main">
        {!table || !tableNode ? <div className="workspace-empty"><div className="workspace-empty-icon"><WorkspaceIcon name="table" size={34} /></div><h2>建立你的第一張表格</h2><p>資料只會儲存在這個瀏覽器。你可以建立桌遊收藏，也可以建立任何自己的資料表。</p><button type="button" className="workspace-dialog-button primary" onClick={() => addTable(null)}>建立表格</button></div> : <>
          <div ref={viewportRef} className={`workspace-table-viewport ${panning ? 'is-panning' : ''}`} onPointerDown={beginTablePan} onPointerMove={(event) => { if (!moveTableReorder(event)) moveTablePan(event); }} onPointerUp={(event) => { if (!endTableReorder(event)) endTablePan(event); }} onPointerCancel={(event) => { if (!endTableReorder(event)) endTablePan(event); }} onClickCapture={(event) => { if (ignoreNextTableClick.current) { event.preventDefault(); event.stopPropagation(); ignoreNextTableClick.current = false; } }}>
            <table className={`workspace-table ${table.transposed ? 'is-transposed' : ''}`} style={{ '--workspace-text-scale': textScale, width: `${tableWidth}px` } as React.CSSProperties}>
              <colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width: `${width}px` }} />)}</colgroup>
              {!table.transposed ? <><thead><tr>
                {rowHeader && <th className={`workspace-row-corner ${overflowClassName(rowHeader)} ${configuring?.isRowHeader ? 'is-editing' : ''}`} style={{ textAlign: rowHeader.alignment ?? 'left' }} onClick={() => setConfiguring({ column: rowHeader, isRowHeader: true })}><WorkspaceHeaderContent label={rowHeader.name} nameClass="workspace-row-axis-name" filterActive={isHeaderFilterActive('column', rowHeader.id)} onFilter={() => setFilterTarget({ axis: 'column', id: rowHeader.id, label: rowHeader.name })} /></th>}
                {table.columns.map((column) => {
                  const isSource = tableReorderVisual?.kind === 'column' && tableReorderVisual.sourceId === column.id;
                  const isTarget = tableReorderVisual?.kind === 'column' && tableReorderVisual.targetId === column.id;
                  return <th key={column.id} data-column-id={column.id} className={`${overflowClassName(column)} ${configuring?.column.id === column.id && !configuring.isRowHeader ? 'is-editing ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} onPointerDown={(event) => beginTableReorder('column', column.id, event)} onClick={() => setConfiguring({ column, isRowHeader: false })} onContextMenu={(event) => { event.preventDefault(); setConfiguring({ column, isRowHeader: false }); }}><WorkspaceHeaderContent label={column.name} nameClass="workspace-column-name" filterActive={isHeaderFilterActive('column', column.id)} onFilter={() => setFilterTarget({ axis: 'column', id: column.id, label: column.name })} /></th>;
                })}
              </tr></thead>
              <tbody>{filteredRows.map((row) => {
                const originalIndex = table.rows.findIndex((item) => item.id === row.id);
                const rowLabel = displayWorkspaceCellValue(row.name, rowHeader!.inputType) || `項目 ${originalIndex + 1}`;
                const isSource = tableReorderVisual?.kind === 'row' && tableReorderVisual.sourceId === row.id;
                const isTarget = tableReorderVisual?.kind === 'row' && tableReorderVisual.targetId === row.id;
                const isRowHeaderActive = activeCell?.rowId === row.id && activeCell.columnId === rowHeader?.id;
                return <tr key={row.id}>
                  {rowHeader && <th scope="row" data-row-id={row.id} className={`workspace-row-heading ${overflowClassName(rowHeader)} ${isRowHeaderActive ? 'is-editing ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: rowHeader.alignment ?? 'left' }} onPointerDown={(event) => beginTableReorder('row', row.id, event)} onClick={() => openCell(row, rowHeader)} onContextMenu={(event) => { event.preventDefault(); askDeleteRow(row, originalIndex); }}><div className="workspace-cell-layout"><button type="button" className="workspace-row-name" aria-label={`編輯項目 ${rowLabel}`}><span className="workspace-cell-value">{rowLabel}</span></button><ExternalLinkAction value={row.name} /></div></th>}
                  {table.columns.map((column) => {
                    const value = row.values[column.id] ?? null;
                    const displayValue = displayWorkspaceCellValue(value, column.inputType);
                    const isActive = activeCell?.rowId === row.id && activeCell.columnId === column.id;
                    return <td key={column.id} className={`${overflowClassName(column)} ${isActive ? 'is-editing' : ''}`} style={{ textAlign: column.alignment ?? 'left' }} aria-label={`${rowLabel}，${column.name}：${displayValue || '空白'}`} onClick={() => openCell(row, column)}><div className="workspace-cell-layout"><span className={`workspace-cell-value ${displayValue ? '' : 'workspace-empty-cell'}`}>{displayValue}</span><ExternalLinkAction value={value} /></div></td>;
                  })}
                </tr>;
              })}</tbody></> : <><thead><tr>
                {rowHeader && <th className={`workspace-row-corner ${overflowClassName(rowHeader)} ${configuring?.isRowHeader ? 'is-editing' : ''}`} style={{ textAlign: rowHeader.alignment ?? 'left' }} onClick={() => setConfiguring({ column: rowHeader, isRowHeader: true })}><WorkspaceHeaderContent label={rowHeader.name} nameClass="workspace-row-axis-name" filterActive={isHeaderFilterActive('column', rowHeader.id)} onFilter={() => setFilterTarget({ axis: 'column', id: rowHeader.id, label: rowHeader.name })} /></th>}
                {filteredRows.map((row) => {
                  const originalIndex = table.rows.findIndex((item) => item.id === row.id);
                  const rowLabel = displayWorkspaceCellValue(row.name, rowHeader!.inputType) || `項目 ${originalIndex + 1}`;
                  const isSource = tableReorderVisual?.kind === 'row' && tableReorderVisual.sourceId === row.id;
                  const isTarget = tableReorderVisual?.kind === 'row' && tableReorderVisual.targetId === row.id;
                  const isActive = activeCell?.rowId === row.id && activeCell.columnId === rowHeader?.id;
                  return <th key={row.id} data-row-id={row.id} className={`${overflowClassName(rowHeader!)} ${isActive ? 'is-editing ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} onPointerDown={(event) => beginTableReorder('row', row.id, event)} onClick={() => rowHeader && openCell(row, rowHeader)} onContextMenu={(event) => { event.preventDefault(); askDeleteRow(row, originalIndex); }}><WorkspaceHeaderContent label={rowLabel} nameClass="workspace-column-name" editLabel={`編輯項目 ${rowLabel}`} filterActive={isHeaderFilterActive('row', row.id)} onFilter={() => setFilterTarget({ axis: 'row', id: row.id, label: rowLabel })} /></th>;
                })}
              </tr></thead><tbody>
                {visibleColumns.map((column) => {
                  const isSource = tableReorderVisual?.kind === 'column' && tableReorderVisual.sourceId === column.id;
                  const isTarget = tableReorderVisual?.kind === 'column' && tableReorderVisual.targetId === column.id;
                  return <tr key={column.id}>
                    <th scope="row" data-column-id={column.id} className={`workspace-row-heading ${overflowClassName(column)} ${configuring?.column.id === column.id && !configuring.isRowHeader ? 'is-editing ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: column.alignment ?? 'left' }} onPointerDown={(event) => beginTableReorder('column', column.id, event)} onClick={() => setConfiguring({ column, isRowHeader: false })} onContextMenu={(event) => { event.preventDefault(); setConfiguring({ column, isRowHeader: false }); }}><button type="button" className="workspace-row-name">{column.name}</button></th>
                    {filteredRows.map((row) => {
                      const rowLabel = displayWorkspaceCellValue(row.name, rowHeader!.inputType) || '未命名項目';
                      const value = row.values[column.id] ?? null;
                      const displayValue = displayWorkspaceCellValue(value, column.inputType);
                      const isActive = activeCell?.rowId === row.id && activeCell.columnId === column.id;
                      return <td key={row.id} className={`${overflowClassName(column)} ${isActive ? 'is-editing' : ''}`} style={{ textAlign: column.alignment ?? 'left' }} aria-label={`${rowLabel}，${column.name}：${displayValue || '空白'}`} onClick={() => openCell(row, column)}><div className="workspace-cell-layout"><span className={`workspace-cell-value ${displayValue ? '' : 'workspace-empty-cell'}`}>{displayValue}</span><ExternalLinkAction value={value} /></div></td>;
                    })}
                  </tr>;
                })}
              </tbody></>}
            </table>
          </div>
          <div className="workspace-zoom-indicator"><button type="button" onClick={() => applyTextScale(textScaleRef.current - 0.1)} aria-label="縮小文字">−</button><span>{Math.round(textScale * 100)}%</span><button type="button" onClick={() => applyTextScale(textScaleRef.current + 0.1)} aria-label="放大文字">＋</button><button type="button" onClick={() => applyTextScale(minTextScale)} aria-label="縮到可完整顯示欄位">適合寬度</button></div>
        </>}
      </main>
      <button type="button" className="workspace-fab" onClick={addRow} disabled={!table} aria-label="新增項目"><WorkspaceIcon name="plus" size={38} /></button>
    </div>
    {drawerOpen && <><button type="button" className="workspace-drawer-backdrop" aria-label="關閉目錄" onClick={() => setDrawerOpen(false)} /><aside className="workspace-drawer" aria-label="Workspace 目錄"><header className="workspace-drawer-heading"><strong>目錄</strong><div><button type="button" className="workspace-drawer-create" onClick={() => addFolder(null)} aria-label="新增資料夾"><WorkspaceIcon name="folder-plus" size={21} /><span>資料夾</span></button><button type="button" className="workspace-drawer-create" onClick={() => setTableCreateParentId(null)} aria-label="新增表格"><WorkspaceIcon name="table-plus" size={21} /><span>表格</span></button><button type="button" onClick={() => setDrawerOpen(false)} aria-label="關閉目錄"><WorkspaceIcon name="close" size={22} /></button></div></header><Tree data={data} expanded={expanded} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={openNode} onContext={setNodeMenu} onMove={relocateNode} /><footer className="workspace-drawer-footer"><div className="workspace-drawer-data-actions"><button type="button" onClick={exportAll}><WorkspaceIcon name="download" size={19} />匯出全部資料</button><button type="button" onClick={() => chooseImport('workspace')}><WorkspaceIcon name="upload" size={19} />匯入整個資料庫</button></div><a href="/"><WorkspaceIcon name="home" size={19} />返回網站</a></footer></aside></>}
    <input ref={importTableInputRef} id="workspace-import-table" className="sr-only" tabIndex={-1} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'table'); event.currentTarget.value = ''; }} />
    <input ref={importWorkspaceInputRef} id="workspace-import-workspace" className="sr-only" tabIndex={-1} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'workspace'); event.currentTarget.value = ''; }} />
    {nodeMenu && <NodeActionsDialog node={nodeMenu} onClose={() => setNodeMenu(undefined)} onRename={() => { setNodeMenu(undefined); renameNode(nodeMenu); }} onDelete={() => askDeleteNode(nodeMenu)} onAddFolder={() => { setNodeMenu(undefined); addFolder(nodeMenu.id); }} onAddTable={() => { setNodeMenu(undefined); setTableCreateParentId(nodeMenu.id); }} onMove={() => { setMovingNode(nodeMenu); setNodeMenu(undefined); }} />}
    {movingNode && <MoveNodeDialog node={movingNode} data={data} onClose={() => setMovingNode(undefined)} onMove={(parentId) => relocateNode(movingNode, parentId)} />}
    {tableActionsOpen && table && <TableActionsDialog tableName={table.name} transposed={Boolean(table.transposed)} onClose={() => setTableActionsOpen(false)} onExport={exportCurrent} onSearch={() => { setTableActionsOpen(false); setSearchOpen(true); }} onTranspose={() => { commit(updateTable(data, table.id, (current) => ({ ...current, transposed: !current.transposed, updatedAt: Date.now() }))); setTableActionsOpen(false); }} />}
    {filterTarget && <HeaderFilterDialog label={filterTarget.label} options={activeFilterOptions} state={activeFilterState} onClose={() => setFilterTarget(undefined)} onSort={setActiveFilterSort} onToggle={toggleActiveFilterOption} onSelectAll={() => updateActiveFilter((state) => ({ ...state, includedKeys: null }))} onClearAll={() => updateActiveFilter((state) => ({ ...state, includedKeys: [] }))} />}
    {tableCreateParentId !== undefined && <TableCreateDialog onClose={() => setTableCreateParentId(undefined)} onCreate={() => { const parentId = tableCreateParentId; setTableCreateParentId(undefined); addTable(parentId); }} onImport={() => { importTableParentId.current = tableCreateParentId; chooseImport('table'); }} />}
    {nameDialog && <NameDialog state={nameDialog} onClose={() => setNameDialog(undefined)} onSubmit={submitName} onDelete={nameDialog.row ? () => { const row = nameDialog.row!; setNameDialog(undefined); askDeleteRow(row, table?.rows.findIndex((item) => item.id === row.id) ?? 0); } : undefined} />}
    {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} onClose={() => setConfirmDialog(undefined)} onConfirm={confirmDialog.onConfirm} />}
    {activeEditingRow && activeEditingColumn && (activeEditingColumn.inputType === 'link'
      ? <LinkInputDialog column={activeEditingColumn} value={activeEditingValue} onDelete={activeEditingColumn.id === rowHeader?.id ? () => { setEditing(undefined); askDeleteRow(activeEditingRow, activeEditingRowIndex); } : undefined} onSave={(next) => saveCellValue(activeEditingRow.id, activeEditingColumn, next)} />
      : <CellInputDialog column={activeEditingColumn} value={activeEditingValue} inputLabel={activeEditingColumn.id === rowHeader?.id ? '項目名稱' : undefined} onDelete={activeEditingColumn.id === rowHeader?.id ? () => { setEditing(undefined); askDeleteRow(activeEditingRow, activeEditingRowIndex); } : undefined} onSave={(next) => updateCell(activeEditingRow.id, activeEditingColumn, next)} />)}
    {configuring && <ColumnConfig column={configuring.column} onSave={saveColumn} onDelete={configuring.isRowHeader ? undefined : () => { askDeleteColumn(configuring.column); setConfiguring(undefined); }} />}
    {selectionEditor && <WorkspaceSelectionDialog column={selectionEditor.column} value={selectionEditor.value} options={selectionEditor.options} onClose={() => setSelectionEditor(undefined)} onSelect={selectCellValue} />}
    {workspaceImport && <WorkspaceModal title="匯入整個資料庫" onClose={() => setWorkspaceImport(undefined)}><div className="workspace-import-actions"><button type="button" className="workspace-dialog-button secondary" onClick={() => finishWorkspaceImport('merge')}>合併</button><button type="button" className="workspace-dialog-button danger" onClick={() => finishWorkspaceImport('replace')}>取代</button></div></WorkspaceModal>}
  </section>;
};

export { WorkspacePage };
