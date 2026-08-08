import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadWorkspace, saveWorkspace } from '../workspace/db';
import { createColumn, createNode, createRow, createTable, getChildren, getDynamicOptions, getTableForNode, removeNodeAndDescendants } from '../workspace/model';
import { cloneImportedWorkspace, exportWorkspaceXlsx, importWorkspaceXlsx } from '../workspace/spreadsheet';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceInputType, WorkspaceNode, WorkspaceTable } from '../workspace/types';

const inputTypeLabels: Record<WorkspaceInputType, string> = {
  text: '文字', number: '數字', select: '固定列表', 'dynamic-select': '動態列表',
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

interface CellEditorProps {
  column: WorkspaceColumn;
  value: WorkspaceCellValue;
  options: string[];
  onSave(value: string): void;
  onCancel(): void;
}

const CellEditor = ({ column, value, options, onSave, onCancel }: CellEditorProps) => {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  useEffect(() => { inputRef.current?.focus(); if (inputRef.current instanceof HTMLInputElement) inputRef.current.select(); }, []);

  const commit = () => onSave(draft);
  if (column.inputType === 'select') return <select ref={inputRef as React.RefObject<HTMLSelectElement>} className="workspace-cell-editor" autoFocus value={draft} onChange={(event) => { setDraft(event.target.value); onSave(event.target.value); }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}>
    <option value="">選擇…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}
  </select>;
  if (column.inputType === 'dynamic-select') return <DynamicSelectEditor value={draft} options={options} onSave={onSave} onCancel={onCancel} />;
  if (column.inputType === 'number') return <input ref={inputRef as React.RefObject<HTMLInputElement>} className="workspace-cell-editor" type="number" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') onCancel(); }} />;
  return <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} className="workspace-cell-editor workspace-text-editor" inputMode="text" rows={Math.max(1, draft.split('\n').length)} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); } }} />;
};

const DynamicSelectEditor = ({ value, options, onSave, onCancel }: { value: string; options: string[]; onSave(value: string): void; onCancel(): void }) => {
  const [draft, setDraft] = useState(value);
  const filtered = options.filter((option) => option.toLocaleLowerCase().includes(draft.toLocaleLowerCase()));
  const hasExact = options.some((option) => option === draft);
  return <div className="workspace-dynamic-editor">
    <input autoFocus className="workspace-cell-editor" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onSave(draft); } if (event.key === 'Escape') onCancel(); }} onBlur={() => window.setTimeout(() => onSave(draft), 120)} placeholder="搜尋或新增…" />
    <div className="workspace-option-menu" role="listbox">
      {filtered.map((option) => <button type="button" role="option" key={option} onMouseDown={(event) => event.preventDefault()} onClick={() => onSave(option)}>{option}</button>)}
      {!hasExact && draft.trim() && <button type="button" className="workspace-create-option" onMouseDown={(event) => event.preventDefault()} onClick={() => onSave(draft.trim())}>新增「{draft.trim()}」</button>}
      {!filtered.length && !draft.trim() && <span>輸入文字以搜尋或新增</span>}
    </div>
  </div>;
};

const Tree = ({ data, expanded, onToggle, onOpen, onRename, onDelete, onAddFolder, onAddTable }: {
  data: WorkspaceData;
  expanded: Set<string>;
  onToggle(id: string): void;
  onOpen(node: WorkspaceNode): void;
  onRename(node: WorkspaceNode): void;
  onDelete(node: WorkspaceNode): void;
  onAddFolder(parentId: string | null): void;
  onAddTable(parentId: string | null): void;
}) => {
  const render = (parentId: string | null, depth = 0): React.ReactNode => getChildren(data, parentId).map((node) => {
    const children = node.type === 'folder' ? getChildren(data, node.id) : [];
    const isOpen = expanded.has(node.id);
    return <div key={node.id} className="workspace-tree-item" style={{ '--workspace-depth': depth } as React.CSSProperties}>
      <div className={`workspace-tree-row ${data.activeNodeId === node.id ? 'active' : ''}`}>
        {node.type === 'folder' ? <button type="button" className="workspace-tree-toggle" onClick={() => onToggle(node.id)} aria-label={isOpen ? '收合資料夾' : '展開資料夾'}>{isOpen ? '⌄' : '›'}</button> : <span className="workspace-tree-spacer" />}
        <button type="button" className="workspace-tree-name" onClick={() => onOpen(node)}><span aria-hidden="true">{node.type === 'folder' ? (isOpen ? '▾' : '▸') : '▤'}</span>{node.name}</button>
        <button type="button" className="workspace-tree-more" onClick={() => onRename(node)} aria-label={`重新命名${node.name}`}>⋯</button>
        <button type="button" className="workspace-tree-more" onClick={() => onDelete(node)} aria-label={`刪除${node.name}`}>×</button>
      </div>
      {node.type === 'folder' && isOpen && <div className="workspace-tree-children">{render(node.id, depth + 1)}<div className="workspace-tree-actions"><button type="button" onClick={() => onAddFolder(node.id)}>＋資料夾</button><button type="button" onClick={() => onAddTable(node.id)}>＋表格</button></div></div>}
      {node.type === 'folder' && !isOpen && children.length > 0 && null}
    </div>;
  });
  return <div className="workspace-tree">{render(null)}{!data.nodes.some((node) => node.parentId === null) && <p className="workspace-tree-empty">尚未建立資料夾或表格</p>}</div>;
};

const ColumnConfig = ({ column, onSave, onClose }: { column: WorkspaceColumn; onSave(column: WorkspaceColumn): void; onClose(): void }) => {
  const [draft, setDraft] = useState(column);
  return <div className="workspace-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-column-dialog-title">
      <h2 id="workspace-column-dialog-title">欄位設定</h2>
      <label>欄位名稱<input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>輸入類型<select value={draft.inputType} onChange={(event) => setDraft({ ...draft, inputType: event.target.value as WorkspaceInputType })}>{Object.entries(inputTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {draft.inputType === 'select' && <label>固定選項（每行一項）<textarea rows={5} value={draft.options.join('\n')} onChange={(event) => setDraft({ ...draft, options: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label>}
      <div className="workspace-dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="button" className="button primary" onClick={() => onSave({ ...draft, name: draft.name.trim() || '未命名欄位' })}>儲存</button></div>
    </section>
  </div>;
};

const WorkspacePage = () => {
  const [data, setData] = useState<WorkspaceData>();
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rowId: string; columnId: string }>();
  const [configuring, setConfiguring] = useState<WorkspaceColumn>();
  const [importing, setImporting] = useState<{ file: File; kind: 'table' | 'workspace'; data: WorkspaceData }>();
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(0.35);
  const viewportRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | undefined>(undefined);

  useEffect(() => { void loadWorkspace().then((loaded) => { setData(loaded); setExpanded(new Set(loaded.nodes.filter((node) => node.type === 'folder').map((node) => node.id))); }); }, []);

  const commit = useCallback((next: WorkspaceData) => { setData(next); void saveWorkspace(next); }, []);
  const table = useMemo(() => data ? getTableForNode(data, data.activeNodeId) : undefined, [data]);
  const tableNode = useMemo(() => table && data ? findTableNode(data, table.id) : undefined, [data, table]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const element = tableRef.current;
    if (!viewport || !element || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const naturalWidth = Math.max(1, element.getBoundingClientRect().width / Math.max(zoom, 0.01));
      const fit = Math.min(1, viewport.clientWidth / naturalWidth);
      setMinZoom(Math.max(0.2, fit));
      setZoom((current) => Math.max(Math.max(0.2, fit), Math.min(2, current)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport); observer.observe(element);
    return () => observer.disconnect();
  }, [table, zoom]);

  const addFolder = (parentId: string | null) => {
    if (!data) return;
    const name = window.prompt('資料夾名稱', '新資料夾')?.trim();
    if (!name) return;
    const siblings = getChildren(data, parentId);
    const node = createNode('folder', name, parentId, siblings.length);
    commit({ ...data, nodes: [...data.nodes, node] }); setExpanded((current) => new Set(current).add(parentId ?? node.id));
  };
  const addTable = (parentId: string | null) => {
    if (!data) return;
    const name = window.prompt('表格名稱', '新表格')?.trim();
    if (!name) return;
    const currentTable = createTable(name);
    const node = createNode('table', currentTable.name, parentId, getChildren(data, parentId).length, currentTable.id);
    commit({ ...data, tables: [...data.tables, currentTable], nodes: [...data.nodes, node], activeNodeId: node.id });
    setExpanded((current) => new Set(current).add(parentId ?? node.id)); setDrawerOpen(false);
  };
  const renameNode = (node: WorkspaceNode) => {
    if (!data) return;
    const name = window.prompt('重新命名', node.name)?.trim();
    if (!name) return;
    const next = { ...data, nodes: data.nodes.map((item) => item.id === node.id ? { ...item, name } : item), tables: node.tableId ? data.tables.map((item) => item.id === node.tableId ? { ...item, name, updatedAt: Date.now() } : item) : data.tables };
    commit(next);
  };
  const deleteNode = (node: WorkspaceNode) => {
    if (!data || !window.confirm(`確定要刪除「${node.name}」嗎？`)) return;
    commit(removeNodeAndDescendants(data, node.id));
  };
  const openNode = (node: WorkspaceNode) => {
    if (!data) return;
    if (node.type === 'folder') { setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); return; }
    commit({ ...data, activeNodeId: node.id }); setDrawerOpen(false);
  };

  const updateCell = (rowId: string, column: WorkspaceColumn, raw: string) => {
    if (!data || !table) return;
    if (column.inputType === 'number' && raw.trim() && !Number.isFinite(Number(raw))) { setNotice('請輸入有效數字'); return; }
    const value: WorkspaceCellValue = !raw.trim() ? null : column.inputType === 'number' ? (Number.isFinite(Number(raw)) ? Number(raw) : null) : raw;
    commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.map((row) => row.id === rowId ? { ...row, values: { ...row.values, [column.id]: value } } : row) })));
    setEditing(undefined);
  };
  const addRow = () => { if (!data || !table) return; commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: [...current.rows, createRow(current.columns)] }))); };
  const deleteRow = (rowId: string) => { if (!data || !table || !window.confirm('確定要刪除這一列嗎？')) return; commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.filter((row) => row.id !== rowId) }))); };
  const addColumn = () => { if (!data || !table) return; const column = createColumn(`欄位 ${table.columns.length + 1}`); commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: [...current.columns, column], rows: current.rows.map((row) => ({ ...row, values: { ...row.values, [column.id]: null } })) }))); setConfiguring(column); };
  const deleteColumn = (column: WorkspaceColumn) => { if (!data || !table || !window.confirm(`確定要刪除欄位「${column.name}」嗎？`)) return; commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: current.columns.filter((item) => item.id !== column.id), rows: current.rows.map((row) => { const values = { ...row.values }; delete values[column.id]; return { ...row, values }; }) }))); };
  const saveColumn = (column: WorkspaceColumn) => { if (!data || !table) return; commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: current.columns.map((item) => item.id === column.id ? column : item) }))); setConfiguring(undefined); };

  const exportCurrent = () => { if (!data || !table) return; download(exportWorkspaceXlsx(data, table), `${fileBaseName(table.name)}.xlsx`); };
  const exportAll = () => { if (!data) return; download(exportWorkspaceXlsx(data), 'workspace.xlsx'); };
  const chooseImport = (kind: 'table' | 'workspace') => { setImporting(undefined); const input = document.getElementById(`workspace-import-${kind}`) as HTMLInputElement | null; input?.click(); };
  const readImport = async (file: File, kind: 'table' | 'workspace') => {
    try {
      const imported = await importWorkspaceXlsx(file);
      if (kind === 'table') {
        if (imported.isWorkspace || !imported.table || !data) throw new Error('請選擇單張表格檔案');
        const tableCopy = imported.table;
        const node = createNode('table', tableCopy.name, null, getChildren(data, null).length, tableCopy.id);
        commit({ ...data, tables: [...data.tables, tableCopy], nodes: [...data.nodes, node], activeNodeId: node.id }); setNotice('單張表格已匯入'); setDrawerOpen(false);
      } else {
        if (!imported.isWorkspace || !imported.data || !data) throw new Error('請選擇整個 Workspace 檔案');
        setImporting({ file, kind, data: imported.data });
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : '匯入失敗'); }
  };
  const finishWorkspaceImport = (mode: 'replace' | 'merge') => {
    if (!data) return;
    const imported = importing?.data;
    if (!imported) return;
    const next = mode === 'replace' ? { ...imported, activeNodeId: imported.nodes.find((node) => node.type === 'table')?.id ?? null } : (() => {
      const copy = cloneImportedWorkspace(imported);
      return { ...data, nodes: [...data.nodes, ...copy.nodes], tables: [...data.tables, ...copy.tables], activeNodeId: copy.nodes.find((node) => node.type === 'table')?.id ?? data.activeNodeId };
    })();
    commit(next); setImporting(undefined); setNotice(mode === 'replace' ? 'Workspace 已取代' : 'Workspace 已合併');
  };

  if (!data) return <section className="workspace-page workspace-loading"><p>正在開啟本地 Workspace…</p></section>;
  return <section className="workspace-page">
    <header className="workspace-header"><div className="workspace-title-group"><button type="button" className="workspace-menu-button" aria-label="開啟目錄" onClick={() => setDrawerOpen((current) => !current)}>☰</button><div><p className="eyebrow">LOCAL WORKSPACE</p><h1>動態表格</h1></div></div><div className="workspace-header-actions"><a className="button secondary" href="/">返回網站</a><button type="button" className="button secondary" onClick={addTable.bind(null, null)}>＋表格</button><button type="button" className="button secondary" onClick={() => addFolder(null)}>＋資料夾</button></div></header>
    {notice && <div className="workspace-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')} aria-label="關閉通知">×</button></div>}
    <div className="workspace-layout">
      {drawerOpen && <aside className="workspace-drawer" aria-label="Workspace 目錄"><div className="workspace-drawer-heading"><strong>目錄</strong><button type="button" onClick={() => setDrawerOpen(false)} aria-label="關閉目錄">×</button></div><Tree data={data} expanded={expanded} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={openNode} onRename={renameNode} onDelete={deleteNode} onAddFolder={addFolder} onAddTable={addTable} /></aside>}
      <main className="workspace-main">
        {!table || !tableNode ? <div className="workspace-empty"><div className="workspace-empty-icon">▤</div><h2>建立你的第一張表格</h2><p>資料只會儲存在這個瀏覽器。你可以建立桌遊收藏，也可以建立任何自己的資料表。</p><button type="button" className="button primary" onClick={() => addTable(null)}>建立表格</button></div> : <>
          <div className="workspace-table-toolbar"><div><button type="button" className="workspace-breadcrumb" onClick={() => setDrawerOpen(true)}>目錄</button><span aria-hidden="true">／</span><button type="button" className="workspace-table-name" onClick={() => renameNode(tableNode)}>{table.name}</button></div><div className="workspace-toolbar-actions"><button type="button" onClick={addRow}>＋列</button><button type="button" onClick={addColumn}>＋欄</button><button type="button" onClick={exportCurrent}>匯出此表</button><button type="button" onClick={() => chooseImport('table')}>匯入單表</button><button type="button" onClick={exportAll}>匯出全部</button><button type="button" onClick={() => chooseImport('workspace')}>匯入全部</button><input id="workspace-import-table" hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'table'); event.currentTarget.value = ''; }} /><input id="workspace-import-workspace" hidden type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'workspace'); event.currentTarget.value = ''; }} /></div></div>
          <div className="workspace-zoom-toolbar"><button type="button" onClick={() => setZoom((current) => Math.max(minZoom, current - 0.1))} aria-label="縮小表格">−</button><input aria-label="表格縮放比例" type="range" min={minZoom} max="2" step="0.05" value={Math.max(minZoom, zoom)} onChange={(event) => setZoom(Number(event.target.value))} /><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom(minZoom)} aria-label="縮到可完整顯示欄位">最小</button><button type="button" onClick={() => setZoom((current) => Math.min(2, current + 0.1))} aria-label="放大表格">＋</button></div>
          <div ref={viewportRef} className="workspace-table-viewport" onWheel={(event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom((current) => Math.max(minZoom, Math.min(2, current - event.deltaY * 0.002))); } }} onPointerDown={(event) => { if (event.pointerType === 'touch') { pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.current.size === 2) { const points = [...pointers.current.values()]; pinchStart.current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom }; } } }} onPointerMove={(event) => { if (event.pointerType !== 'touch' || !pointers.current.has(event.pointerId)) return; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (pointers.current.size === 2 && pinchStart.current) { const points = [...pointers.current.values()]; const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); setZoom(Math.max(minZoom, Math.min(2, pinchStart.current.zoom * distance / pinchStart.current.distance))); event.preventDefault(); } }} onPointerUp={(event) => { pointers.current.delete(event.pointerId); if (pointers.current.size < 2) pinchStart.current = undefined; }} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); pinchStart.current = undefined; }}>
            <table ref={tableRef} className="workspace-table" style={{ zoom } as React.CSSProperties}><thead><tr><th className="workspace-row-corner">#</th>{table.columns.map((column) => <th key={column.id}><div className="workspace-column-heading"><button type="button" onClick={() => setConfiguring(column)}>{column.name}</button><small>{inputTypeLabels[column.inputType]}</small><span><button type="button" onClick={() => setConfiguring(column)} aria-label={`設定${column.name}`}>⚙</button><button type="button" onClick={() => deleteColumn(column)} aria-label={`刪除${column.name}`}>×</button></span></div></th>)}</tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={row.id}><th className="workspace-row-heading"><span>{rowIndex + 1}</span><button type="button" onClick={() => deleteRow(row.id)} aria-label={`刪除第${rowIndex + 1}列`}>×</button></th>{table.columns.map((column) => { const isEditing = editing?.rowId === row.id && editing.columnId === column.id; const value = row.values[column.id]; const options = column.inputType === 'dynamic-select' ? getDynamicOptions(table, column.id) : column.options; return <td key={column.id} onClick={() => !isEditing && setEditing({ rowId: row.id, columnId: column.id })}>{isEditing ? <CellEditor column={column} value={value} options={options} onSave={(next) => updateCell(row.id, column, next)} onCancel={() => setEditing(undefined)} /> : <span className={value == null || value === '' ? 'workspace-empty-cell' : ''}>{value == null || value === '' ? '點按輸入' : String(value)}</span>}</td>; })}</tr>)}</tbody></table>
          </div>
        </>}
      </main>
    </div>
    {configuring && <ColumnConfig column={configuring} onSave={saveColumn} onClose={() => setConfiguring(undefined)} />}
    {importing && <div className="workspace-overlay"><section className="workspace-dialog" role="dialog" aria-modal="true"><h2>匯入整個 Workspace</h2><p>要如何處理目前瀏覽器中的資料？</p><div className="workspace-dialog-actions"><button type="button" className="button secondary" onClick={() => setImporting(undefined)}>取消</button><button type="button" className="button secondary" onClick={() => finishWorkspaceImport('merge')}>合併</button><button type="button" className="button danger" onClick={() => finishWorkspaceImport('replace')}>取代</button></div></section></div>}
  </section>;
};

export { WorkspacePage };
