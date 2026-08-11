import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { formatWorkspaceDateTime, isWorkspaceLinkValue, normalizeWorkspaceDateTime, parseMultiSelectValues } from "./model";
import { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceNode, WorkspaceOverflowMode, WorkspaceRow, WorkspaceTable } from "./types";

export type IconName = 'menu' | 'search' | 'filter' | 'edit' | 'check' | 'refresh' | 'close' | 'folder' | 'folder-plus' | 'table' | 'table-plus' | 'chevron' | 'more' | 'plus' | 'settings' | 'trash' | 'back' | 'download' | 'upload' | 'rows' | 'columns' | 'home' | 'up' | 'down' | 'move' | 'align-left' | 'align-center' | 'align-right' | 'external';
export type WorkspaceInputCategory = 'text' | 'select' | 'other';
export type TableReorderKind = 'row' | 'column';
export type TableReorderVisual = { kind: TableReorderKind; sourceId: string; targetId: string; after: boolean };
export type TableReorderSession = TableReorderVisual & { pointerId: number; startX: number; startY: number; active: boolean; timer?: number };
export type HeaderFilterTarget = { axis: 'column' | 'row'; id: string; label: string };
export type HeaderFilterAggregate = 'sum' | 'average';
export type HeaderFilterState = { includedKeys: string[] | null; sort: 'asc' | 'desc' | null; query?: string; min?: string; max?: string; aggregate?: HeaderFilterAggregate };
export type HeaderFilterOption = { key: string; label: string; count: number };
export type NameDialogState = { mode: 'folder' | 'table' | 'row' | 'axis' | 'rename'; initialValue: string; parentId?: string | null; node?: WorkspaceNode; row?: WorkspaceRow; table?: WorkspaceTable };
export const inputCategoryLabels: Record<WorkspaceInputCategory, string> = {
  text: '文字', select: '選單', other: '其他',
};
export const inputSubtypeLabels: Record<WorkspaceInputCategory, Array<{ value: WorkspaceInputType; label: string }>> = {
  text: [{ value: 'text', label: '文字' }, { value: 'number', label: '數字' }],
  select: [{ value: 'dynamic-select', label: '動態列表' }, { value: 'select', label: '固定列表' }],
  other: [{ value: 'datetime', label: '時間(含日期)' }, { value: 'link', label: '連結' }],
};
export const overflowModeLabels: Record<WorkspaceOverflowMode, string> = {
  expand: '推擠寬度', ellipsis: '超過省略', wrap: '自動換行',
};
export const workspaceCellPadding = 22;
export const workspaceMinColumnWidth = 40;
export const workspaceMaxTextScale = 2.5;
export const expandedFoldersStorageKey = 'board-game-helper-workspace-expanded-folders';
export const tableReorderHoldMs = 420;
export type WorkspaceTableLayout = { naturalColumnWidths: number[]; columnWidths: number[]; tableWidth: number };
export const calculateWorkspaceTableLayout = (columnTextWidths: readonly number[], textScale: number, viewportWidth: number): WorkspaceTableLayout => {
  const naturalColumnWidths = columnTextWidths.map((textWidth) => Math.max(workspaceMinColumnWidth, textWidth * textScale + workspaceCellPadding));
  const baseColumnWidths = columnTextWidths.map((textWidth) => Math.max(workspaceMinColumnWidth, textWidth + workspaceCellPadding));
  const naturalTableWidth = naturalColumnWidths.reduce((total, width) => total + width, 0);
  const baseTableWidth = baseColumnWidths.reduce((total, width) => total + width, 0);
  const baselineExtraWidth = Math.max(0, viewportWidth - baseTableWidth);
  const columnWidths = naturalColumnWidths.map((width, index) => width + (baseTableWidth ? baselineExtraWidth * (baseColumnWidths[index] / baseTableWidth) : 0));
  return { naturalColumnWidths, columnWidths, tableWidth: columnWidths.reduce((total, width) => total + width, 0) };
};
export const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const fileBaseName = (name: string) => name.replace(/\.xlsx$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'workspace';
export const externalHref = (raw: string) => {
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
export const searchableWorkspaceCellValue = (value: WorkspaceCellValue, inputType?: WorkspaceInputType) => isWorkspaceLinkValue(value)
  ? `${value.label}\n${value.url}`
  : inputType === 'datetime' ? formatWorkspaceDateTime(value) : value == null ? '' : String(value);
export const workspaceFilterValueKey = (value: WorkspaceCellValue) => value == null
  ? 'empty:'
  : typeof value === 'number'
    ? `number:${value}`
    : isWorkspaceLinkValue(value)
      ? `link:${value.label}\u0000${value.url}`
      : `text:${value}`;
export const isWorkspaceListInput = (inputType?: WorkspaceInputType) => inputType === 'select' || inputType === 'dynamic-select';
export const numericWorkspaceValue = (value: WorkspaceCellValue) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
export const workspaceValueCollator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
export const compareWorkspaceCellValues = (left: WorkspaceCellValue, right: WorkspaceCellValue, inputType?: WorkspaceInputType) => workspaceValueCollator.compare(searchableWorkspaceCellValue(left, inputType), searchableWorkspaceCellValue(right, inputType));
export const updateTable = (data: WorkspaceData, tableId: string, updater: (table: WorkspaceTable) => WorkspaceTable): WorkspaceData => ({
  ...data,
  tables: data.tables.map((table) => table.id === tableId ? updater(table) : table),
});
export const findTableNode = (data: WorkspaceData, tableId: string) => data.nodes.find((node) => node.type === 'table' && node.tableId === tableId);
export const reorderBeforeOrAfter = <Item extends { id: string }>(items: Item[], sourceId: string, targetId: string, after: boolean) => {
  if (sourceId === targetId) return items;
  const source = items.find((item) => item.id === sourceId);
  if (!source) return items;
  const next = items.filter((item) => item.id !== sourceId);
  const targetIndex = next.findIndex((item) => item.id === targetId);
  if (targetIndex < 0) return items;
  next.splice(targetIndex + (after ? 1 : 0), 0, source);
  return next;
};
export const measureWorkspaceText = (text: string, fontSize: number, fontWeight: number) => {
  if (!text.trim()) return 0;
  if (typeof document === 'undefined') return Math.max(fontSize, text.length * fontSize);
  if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator.userAgent)) return Math.max(fontSize, text.length * fontSize);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return Math.max(fontSize, text.length * fontSize);
  context.font = `${fontWeight} ${fontSize}px "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif`;
  return Math.max(0, ...text.split('\n').filter((line) => line.length > 0).map((line) => context.measureText(line).width));
};
export const overflowClassName = (column: WorkspaceColumn) => `workspace-overflow-${column.overflowMode ?? (column.inputType === 'link' ? 'ellipsis' : 'wrap')}`;
export const dateTimeLocalValue = (value: WorkspaceCellValue) => {
  const source = normalizeWorkspaceDateTime(value) ? new Date(normalizeWorkspaceDateTime(value)!) : new Date();
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${source.getFullYear()}-${pad(source.getMonth() + 1)}-${pad(source.getDate())}T${pad(source.getHours())}:${pad(source.getMinutes())}`;
};
export const inputCategoryFor = (inputType: WorkspaceInputType): WorkspaceInputCategory => inputType === 'select' || inputType === 'dynamic-select' ? 'select' : inputType === 'link' || inputType === 'datetime' ? 'other' : 'text';
export const defaultInputTypeFor = (category: WorkspaceInputCategory): WorkspaceInputType => category === 'select' ? 'dynamic-select' : category === 'other' ? 'datetime' : 'text';
export const hasWorkspaceFilterCriteria = (state: HeaderFilterState) => state.includedKeys !== null || Boolean(state.query?.trim() || state.min?.trim() || state.max?.trim());
export const matchesWorkspaceFilter = (value: WorkspaceCellValue, inputType: WorkspaceInputType | undefined, state: HeaderFilterState, isMultiple?: boolean) => {
  if ((!inputType || isWorkspaceListInput(inputType)) && state.includedKeys !== null) {
    const includedSet = new Set(state.includedKeys);
    const list = (isMultiple || (typeof value === 'string' && /[,，、;；]/.test(value))) ? parseMultiSelectValues(value) : null;
    if (list) {
      if (list.length === 0) {
        if (!includedSet.has(workspaceFilterValueKey(null))) return false;
      } else {
        if (!list.some((item) => includedSet.has(workspaceFilterValueKey(item)))) return false;
      }
    } else {
      if (!includedSet.has(workspaceFilterValueKey(value))) return false;
    }
  }
  const query = state.query?.trim().toLocaleLowerCase();
  if (query && !searchableWorkspaceCellValue(value, inputType).toLocaleLowerCase().includes(query)) return false;
  if (inputType === 'number' && (state.min?.trim() || state.max?.trim())) {
    const numeric = numericWorkspaceValue(value);
    if (numeric === undefined) return false;
    const minimum = state.min?.trim() ? Number(state.min) : undefined;
    const maximum = state.max?.trim() ? Number(state.max) : undefined;
    if (minimum !== undefined && Number.isFinite(minimum) && numeric < minimum) return false;
    if (maximum !== undefined && Number.isFinite(maximum) && numeric > maximum) return false;
  }
  return true;
};
export const WorkspaceIcon = ({ name, size = 24 }: { name: IconName; size?: number }) => {
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
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, forwardedRef) => {
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
export const WorkspaceModal = ({ title, children, actions, leadingAction, onClose, className = '' }: { title: string; children: React.ReactNode; actions?: React.ReactNode; leadingAction?: React.ReactNode; onClose(): void; className?: string }) => {
  const [visualViewport, setVisualViewport] = useState<{ top: number; left: number; width: number; height: number }>();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
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
  return <div className={`workspace-overlay ${className ? `${className}-overlay` : ''}`} style={overlayStyle} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <section className={`workspace-dialog ${leadingAction ? 'has-leading-action' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
      {leadingAction && <div className="workspace-dialog-leading-action">{leadingAction}</div>}
      <header className="workspace-dialog-heading"><h2 id="workspace-dialog-title">{title}</h2><button type="button" className="workspace-icon-button" onClick={onClose} aria-label="關閉"><WorkspaceIcon name="close" size={21} /></button></header>
      <div className="workspace-dialog-content">{children}</div>
      {actions && <footer className="workspace-dialog-actions">{actions}</footer>}
    </section>
  </div>;
};
export const WorkspaceHeaderContent = ({ label, nameClass, editLabel, accessibleLabel = label || '未命名屬性', filterActive, onFilter }: { label: string; nameClass: string; editLabel?: string; accessibleLabel?: string; filterActive: boolean; onFilter(): void }) => <div className="workspace-header-layout">
  <button type="button" className={nameClass} aria-label={editLabel ?? accessibleLabel}>{label}</button>
  <button type="button" className={`workspace-header-filter ${filterActive ? 'active' : ''}`} aria-label={`篩選 ${accessibleLabel}`} aria-pressed={filterActive} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onFilter(); }}><WorkspaceIcon name="filter" size={14} /></button>
</div>;
export const ExternalLinkAction = ({ value }: { value: WorkspaceCellValue }) => {
  if (!isWorkspaceLinkValue(value)) return null;
  const href = externalHref(value.url);
  return href ? <a className="workspace-cell-external" href={href} target="_blank" rel="noreferrer" aria-label="外連" onClick={(event) => event.stopPropagation()}><WorkspaceIcon name="external" size={16} /></a> : null;
};
