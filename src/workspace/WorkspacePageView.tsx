import { savePwaLastRoute } from '../lib/pwaNavigation';
import { applyWorkspaceMultiSelectBatch } from './bulkEdit';
import { formatDateFilterBound } from './dateFilter';
import { GoogleDriveBackupDialog } from './googleDriveBackup/GoogleDriveBackupDialog';
import { coerceCellValue, displayWorkspaceCellValue, displayWorkspaceColumnValue, MAX_BOTTOM_NAVIGATION_TABLES } from './model';
import { workspaceDrawerWidth } from './useWorkspaceDrawer';
import type { WorkspacePageViewModel } from './useWorkspacePage';
import { MoveNodeDialog, NodeActionsDialog, TableCreateDialog } from './workspaceActionDialogs';
import { WorkspaceBottomNavigation, WorkspaceBottomNavigationDialog } from './WorkspaceBottomNavigation';
import { WorkspaceBulkEditToolbar, WorkspaceBulkMultiSelectDialog, WorkspaceBulkNumberDialog } from './workspaceBulkEdit';
import { WorkspacePasteDialog, WorkspaceTableImportPreviewDialog } from './workspaceDataDialogs';
import { CellInputDialog, ColumnConfig, ColumnVisibilityDialog, ConfirmDialog, HeaderFilterDialog, HiddenFieldsDialog, LinkInputDialog, NameDialog, WorkspaceSelectionDialog } from './workspaceDialogs';
import { WorkspaceModalCloseContext } from './workspaceModalClose';
import { WorkspaceIcon, WorkspaceInputModalityContext, WorkspaceModal, type HeaderFilterState } from './workspaceShared';
import { Tree } from './workspaceSidebar';

const workspaceFilterSummary = (state?: HeaderFilterState) => {
  if (!state) return '';
  const parts: string[] = [];
  const query = state.query?.trim();
  if (query) parts.push(`含「${query}」`);
  if (state.min?.trim() || state.max?.trim()) parts.push(state.datePrecision ? `${formatDateFilterBound(state.min, state.datePrecision) || '不限'}～${formatDateFilterBound(state.max, state.datePrecision) || '不限'}` : `${state.min?.trim() || '-∞'}～${state.max?.trim() || '+∞'}`);
  if (state.includedKeys !== null && !(state.min?.trim() || state.max?.trim())) {
    const selected = state.includedKeys.map(workspaceFilterKeyLabel);
    parts.push(selected.length ? `${selected.slice(0, 2).join('、')}${selected.length > 2 ? '…' : ''}` : '無結果');
  }
  if (state.sort) parts.push(state.sort === 'asc' ? '升冪' : '降冪');
  return parts.join(' · ');
};

const workspaceFilterKeyLabel = (key: string) => key === 'empty:'
  ? '空白'
  : key.startsWith('text:')
    ? key.slice(5)
    : key.startsWith('number:')
      ? key.slice(7)
      : key.startsWith('date-month:')
        ? key.slice(11).replace('-', '/')
        : key.startsWith('link:')
          ? key.slice(5).split('\u0000')[0]
          : key;

const workspaceAppVersion = typeof __APP_VERSION__ === 'undefined' ? '開發版' : __APP_VERSION__;

declare const __APP_VERSION__: string;

export const WorkspacePageView = ({
  data,
  inputModality,
  requestClose,
  storageUpgradeBlocked,
  loadError,
  workspacePageRef,
  workspacePageStyle,
  handleWorkspacePaste,
  clearSearchAndFilters,
  viewportRef,
  table,
  setVirtualScrollTop,
  tableNode,
  hasActiveSearchState,
  readyControls,
  editBarOpen,
  tableActionsOpen,
  notice,
  storageConflict,
  remainingLoadError,
  workspaceToolbarRowCount,
  filterbarRef,
  syncFilterbarScroll,
  filterbarTrackStyle,
  filterbarSlots,
  pasteTarget,
  stableAddTable,
  workspaceTableView,
  virtualKeyboardOpen,
  bottomNavigationItems,
  setEditBarOpen,
  setTableActionsOpen,
  openDrawerNode,
  allTablesReady,
  progressiveRef,
  expanded,
  setExpanded,
  setNotice,
  saveState,
  lastSavedAt,
  backupNeedsAttention,
  lastExportAt,
  driveBackup,
  storageVersion,
  commit,
  toggleColumnVisibility,
  navigationTables,
  closeBottomNavigationDialog,
  activeEditingRow,
  activeEditingColumn,
  activeEditingValue,
  rowHeader,
  activeEditingRowIndex,
  fixedListSuggestions,
  getDynamicOptions,
  hiddenEditorRow,
  hiddenColumns,
  hiddenOptionsByColumn,
  saveHiddenFields,
  pasteTargetLabel,
  pasteMatrix,
  drawer, filter, bulk, actions, history, dialogs,
}: WorkspacePageViewModel) => {
  const { nameDialog, nodeMenu, movingNode, columnVisibilityOpen, bottomNavigationDraft, tableCreateParentId, confirmDialog, configuring, selectionEditor, hiddenFieldsEditor, pasteDialogOpen, tableImportPreview, workspaceImport } = dialogs.state;
  const { bulkColumn } = bulk;
  if (!data) return <WorkspaceInputModalityContext.Provider value={inputModality}><WorkspaceModalCloseContext.Provider value={requestClose}><section className="workspace-page workspace-loading">{storageUpgradeBlocked ? <p>請關閉其他開啟此工作區的分頁或視窗，讓本機儲存格式完成更新。</p> : loadError ? <><p>無法讀取本機表格，請重新開啟再試一次。</p><button type="button" onClick={() => window.location.reload()}>重新開啟</button></> : <p>正在開啟本地 Workspace…</p>}</section></WorkspaceModalCloseContext.Provider></WorkspaceInputModalityContext.Provider>;

  return <WorkspaceInputModalityContext.Provider value={inputModality}><WorkspaceModalCloseContext.Provider value={requestClose}><section ref={workspacePageRef} className="workspace-page" tabIndex={-1} aria-label="動態表格工作區" style={workspacePageStyle} onPaste={handleWorkspacePaste}>
    <h1 className="sr-only">動態表格</h1>
    <header className="workspace-appbar">
      <div className="workspace-appbar-leading">
        <button type="button" className="workspace-appbar-button workspace-menu-button" aria-label={filter.searchOpen ? '清除搜尋與篩選' : '開啟目錄'} onClick={filter.searchOpen ? clearSearchAndFilters : drawer.openDrawer}><WorkspaceIcon name={filter.searchOpen ? 'filter-off' : 'menu'} size={29} /></button>
        {filter.searchOpen ? <div className="workspace-appbar-search" role="search"><input type="text" role="searchbox" aria-label={bulk.bulkSelection ? '搜尋後繼續選取' : '搜尋此表'} placeholder={bulk.bulkSelection ? '搜尋後繼續選取' : '搜尋此表'} inputMode="search" value={filter.searchQuery} onChange={(event) => { if (viewportRef.current) { viewportRef.current.scrollTop = 0; } setVirtualScrollTop(0); filter.setSearchQuery(event.target.value); }} autoFocus /><span className="workspace-appbar-search-count">{filter.filteredRows.length} / {table?.rows.length ?? 0}</span></div> : <button type="button" className={`workspace-appbar-title ${nameDialog?.node?.id === tableNode?.id ? 'is-editing' : ''}`} onClick={() => tableNode && actions.renameNode(tableNode)} disabled={!tableNode} aria-label="重新命名表格"><span>{table?.name ?? '動態表格'}</span></button>}
      </div>
      <div className="workspace-appbar-actions">
        <button type="button" className={`workspace-appbar-button ${filter.searchOpen ? 'active' : ''} ${hasActiveSearchState ? 'has-active-filter' : ''}`} aria-label={bulk.bulkSelection ? '搜尋並繼續批次選取' : '搜尋'} onClick={readyControls.search} disabled={!table}><WorkspaceIcon name="search" size={29} /></button>
        <button type="button" className={`workspace-appbar-button ${editBarOpen ? 'active' : ''}`} aria-label="編輯" onClick={readyControls.edit} disabled={!table}><WorkspaceIcon name="edit" size={29} /></button>
        <button type="button" className={`workspace-appbar-button ${tableActionsOpen ? 'active' : ''}`} aria-label="設定" onClick={readyControls.settings} disabled={!table}><WorkspaceIcon name="settings" size={29} /></button>
      </div>
      {notice && <div className="workspace-notice workspace-appbar-notice" role="status">{notice}</div>}
      {storageConflict
        ? <div className="workspace-notice workspace-appbar-notice workspace-load-error" role="alert">另一個分頁已更新本機資料；此頁無法繼續儲存。請先確認未儲存內容，必要時<button type="button" onClick={actions.exportCurrent}>匯出此表</button>，再重新開啟。</div>
        : remainingLoadError && <div className="workspace-notice workspace-appbar-notice workspace-load-error" role="alert">其他表格讀取失敗，<button type="button" onClick={() => window.location.reload()}>重新開啟</button></div>}
    </header>
    <div className="workspace-toolbar-layer" style={{ '--workspace-toolbar-row-count': workspaceToolbarRowCount } as React.CSSProperties}>
    {bulk.bulkSelection && bulkColumn && <WorkspaceBulkEditToolbar column={bulkColumn} count={bulk.bulkSelection.rowIds.length} numericValues={bulk.bulkNumericValues} onCancel={bulk.closeBulkSelection} onOpenEditor={() => bulk.setBulkEditorOpen(true)} />}
    {filter.searchOpen && table && <div ref={filterbarRef} className={`workspace-filterbar${bulk.bulkSelection && bulkColumn ? ' has-bulk-toolbar' : ''}`} aria-label="欄位篩選工具列" onScroll={(event) => syncFilterbarScroll(event.currentTarget)}><div className="workspace-filterbar-scroll" style={filterbarTrackStyle}>{filterbarSlots.map((target, index) => target ? (() => { const state = filter.headerFilters[`${target.axis}:${target.id}`]; const active = filter.isHeaderFilterActive(target.axis, target.id); const summary = workspaceFilterSummary(state); return <button key={`${target.axis}:${target.id}`} type="button" className={`workspace-filterbar-button ${index === 0 ? 'is-frozen' : ''} ${active ? 'is-filtered' : ''}`} aria-label={`篩選 ${target.label}`} aria-pressed={active} onClick={() => readyControls.filter(target)}><WorkspaceIcon name="filter" size={15} />{summary && <small>{summary}</small>}</button>; })() : <span key={`filterbar-spacer-${index}`} className={`workspace-filterbar-spacer ${index === 0 ? 'is-frozen' : ''}`} aria-hidden="true" />)}</div></div>}
    {editBarOpen && table && <div className="workspace-editbar" aria-label="編輯工具列">
      <div className="workspace-editbar-group workspace-editbar-history">
        <button type="button" className="workspace-editbar-button" aria-label="復原" title={history.currentTableHistory?.past.at(-1) ? `復原：${history.currentTableHistory.past.at(-1)!.label}` : '沒有可復原的操作'} onClick={history.undoTable} disabled={!history.currentTableHistory?.past.length}><WorkspaceIcon name="undo" size={22} /></button>
        <button type="button" className="workspace-editbar-button" aria-label="重做" title={history.currentTableHistory?.future.at(-1) ? `重做：${history.currentTableHistory.future.at(-1)!.label}` : '沒有可重做的操作'} onClick={history.redoTable} disabled={!history.currentTableHistory?.future.length}><WorkspaceIcon name="redo" size={22} /></button>
        <button type="button" className="workspace-editbar-button workspace-paste-button" aria-label="貼上多格" onClick={() => dialogs.set('pasteDialogOpen', true)} disabled={!pasteTarget}><WorkspaceIcon name="clipboard" size={21} /></button>
      </div>
      <div className="workspace-editbar-group workspace-editbar-add">
        <button type="button" className="workspace-editbar-button" aria-label="新增物件" onClick={actions.addRow}><WorkspaceIcon name="rows-plus" size={24} /></button>
        <button type="button" className="workspace-editbar-button" aria-label="新增屬性" onClick={actions.addColumn}><WorkspaceIcon name="columns-plus" size={24} /></button>
      </div>
    </div>}
    {tableActionsOpen && table && <div className="workspace-editbar workspace-table-toolsbar" aria-label="表格工具列">
      <div className="workspace-editbar-group"><button type="button" className="workspace-editbar-button" aria-label="匯出此表" onClick={actions.exportCurrent}><WorkspaceIcon name="download" size={22} /></button></div>
      <div className="workspace-editbar-group"><button type="button" className="workspace-editbar-button" aria-label="欄位顯示設定" onClick={() => dialogs.set('columnVisibilityOpen', true)}><WorkspaceIcon name="visibility" size={23} /></button></div>
    </div>}
    <div className={`workspace-body ${drawer.drawerOpen ? 'drawer-is-open' : ''}`}>
      <main className="workspace-main">
        {!table || !tableNode ? <div className="workspace-empty"><div className="workspace-empty-icon"><WorkspaceIcon name="table" size={34} /></div><h2>{data.nodes.some(node => node.type === 'table') ? '選擇一張表格' : '建立你的第一張表格'}</h2><p>資料只會儲存在這個瀏覽器。你可以建立桌遊收藏，也可以建立任何自己的資料表。</p><button type="button" className="workspace-dialog-button primary" onClick={() => stableAddTable(null)}>建立表格</button></div> : workspaceTableView}
      </main>
    </div>
    </div>
    {!virtualKeyboardOpen && bottomNavigationItems.length > 0 && <WorkspaceBottomNavigation items={bottomNavigationItems} activeTableId={table?.id} onOpen={(item) => {
      const node = data.nodes.find((candidate) => candidate.id === item.nodeId);
      if (!node || node.id === data.activeNodeId) return;
      bulk.closeBulkSelection();
      filter.setSearchOpen(false);
      setEditBarOpen(false);
      setTableActionsOpen(false);
      openDrawerNode(node);
    }} />}
    {drawer.drawerOpen && <><button type="button" className="workspace-drawer-backdrop" aria-label="關閉目錄" onClick={drawer.closeDrawer} style={{ opacity: Math.min(1, drawer.drawerOffset / Math.max(1, workspaceDrawerWidth())) }} /><aside ref={drawer.drawerElementRef} className={`workspace-drawer${drawer.drawerDragging ? ' is-dragging' : ''}`} aria-label="Workspace 目錄" style={{ '--workspace-drawer-offset': `${drawer.drawerOffset}px` } as React.CSSProperties} onPointerDownCapture={drawer.beginDrawerSwipe} onPointerMoveCapture={drawer.moveDrawerSwipe} onPointerUpCapture={drawer.endDrawerSwipe} onPointerCancelCapture={drawer.endDrawerSwipe} onClickCapture={drawer.suppressDrawerSwipeClick}><header className="workspace-drawer-heading"><strong>目錄</strong><div>{(allTablesReady || progressiveRef.current) && <><button type="button" className="workspace-drawer-create" onClick={() => actions.addFolder(null)} aria-label="新增資料夾"><WorkspaceIcon name="folder-plus" size={21} /><span>資料夾</span></button><button type="button" className="workspace-drawer-create" onClick={() => readyControls.createTable(null)} aria-label="新增表格"><WorkspaceIcon name="table-plus" size={21} /><span>表格</span></button></>}<button type="button" onClick={drawer.closeDrawer} aria-label="關閉目錄"><WorkspaceIcon name="close" size={22} /></button></div></header><label className="workspace-drawer-search"><WorkspaceIcon name="search" size={18} /><span className="sr-only">搜尋表格與資料夾</span><input type="search" aria-label="搜尋表格與資料夾" placeholder="搜尋表格或資料夾" value={drawer.drawerQuery} onChange={(event) => drawer.setDrawerQuery(event.target.value)} /><button type="button" onClick={() => drawer.setDrawerQuery('')} aria-label="清除目錄搜尋" disabled={!drawer.drawerQuery}><WorkspaceIcon name="close" size={16} /></button></label><Tree data={data} expanded={expanded} filterQuery={drawer.drawerQuery} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={openDrawerNode} onContext={allTablesReady || progressiveRef.current ? readyControls.context : () => setNotice("正在讀取其他表格，請稍候")} onMove={allTablesReady || progressiveRef.current ? actions.relocateNode : () => setNotice("正在讀取其他表格，請稍候")} onDragStateChange={drawer.handleDrawerItemDragStateChange} /><footer className="workspace-drawer-footer" role={allTablesReady || progressiveRef.current ? undefined : "status"}>{allTablesReady || progressiveRef.current ? <><div className={`workspace-storage-status ${saveState === 'error' ? 'is-error' : ''}`} role="status"><span>{saveState === 'saving' ? '正在儲存於此裝置…' : saveState === 'error' ? '本機儲存失敗' : `已儲存於此裝置${lastSavedAt ? ` · ${new Date(lastSavedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}`}</span><span className={backupNeedsAttention ? 'needs-attention' : ''}>{lastExportAt ? `上次匯出：${new Date(lastExportAt).toLocaleDateString('zh-TW')}` : '尚未匯出資料'}</span></div><button type="button" className={`workspace-storage-status workspace-drive-status-card workspace-drive-storage-status ${driveBackup.status === 'dirty' || driveBackup.status === 'never' || driveBackup.status === 'disconnected' ? 'needs-attention' : ''}`} aria-label="開啟 Google Drive 備份" aria-haspopup="dialog" onClick={readyControls.drive}><span>{driveBackup.status === 'offline' ? 'Google Drive · 目前離線' : driveBackup.status === 'disconnected' ? 'Google Drive · 已主動斷線' : driveBackup.status === 'dirty' ? 'Google Drive · 有未備份變更' : driveBackup.status === 'saved' ? 'Google Drive · 已完成備份' : driveBackup.status === 'checking' ? 'Google Drive · 點按檢查備份' : 'Google Drive · 尚未備份'}</span><span>{driveBackup.status === 'disconnected' ? '自動備份已暫停，請重新連結' : !driveBackup.authorized ? (driveBackup.record.lastBackupAt ? '曾經備份過 · 尚未連結此工作階段' : '點按連結 Google Drive') : driveBackup.record.lastBackupAt ? `上次備份：${new Date(driveBackup.record.lastBackupAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })} · ${driveBackup.record.folderCount} 個資料夾 · ${driveBackup.record.tableCount} 張表格` : '尚未建立雲端備份 · 點按查看'}</span></button><label className={`workspace-auto-backup-toggle${driveBackup.status === 'disconnected' ? ' is-paused' : ''}`}><input type="checkbox" aria-label="自動備份" checked={driveBackup.autoBackupEnabled} onChange={(event) => driveBackup.setAutoBackupEnabled(event.target.checked)} /><span>自動備份</span><small>{driveBackup.status === 'disconnected' ? '已暫停，重新連結後恢復' : driveBackup.autoBackupEnabled ? '每 30 分鐘最多一次' : '僅在手動備份時上傳'}</small></label><div className="workspace-drawer-data-actions"><button type="button" onClick={readyControls.bottomNavigation}><WorkspaceIcon name="bottom-navigation" size={19} />管理底部導覽列</button><button type="button" onClick={() => void actions.exportAll()}><WorkspaceIcon name="download" size={19} />匯出全部資料</button><button type="button" onClick={() => actions.chooseImport('workspace')}><WorkspaceIcon name="upload" size={19} />匯入整個資料庫</button></div><a href="/" onClick={() => savePwaLastRoute({ pathname: '/' })}><WorkspaceIcon name="home" size={19} />返回網站</a></> : (storageConflict ? "另一個分頁已更新本機資料，請先確認未儲存內容" : remainingLoadError ? "其他表格讀取失敗，請重新開啟" : "正在讀取其他表格…")}<div className="workspace-version-info" aria-label="版本資訊">版本 {workspaceAppVersion} · 儲存格式 {storageVersion === null ? "無法取得" : `v${storageVersion}`}</div></footer></aside></>}
    <input ref={actions.importTableInputRef} id="workspace-import-table" className="sr-only" tabIndex={-1} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void actions.readImport(file, 'table'); event.currentTarget.value = ''; }} />
    <input ref={actions.importWorkspaceInputRef} id="workspace-import-workspace" className="sr-only" tabIndex={-1} type="file" accept=".zip,application/zip,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void actions.readImport(file, 'workspace'); event.currentTarget.value = ''; }} />
    {nodeMenu && <NodeActionsDialog node={nodeMenu} onClose={() => dialogs.close('nodeMenu')} onRename={() => { dialogs.close('nodeMenu'); actions.renameNode(nodeMenu); }} onDelete={() => actions.askDeleteNode(nodeMenu)} onAddFolder={() => { dialogs.close('nodeMenu'); actions.addFolder(nodeMenu.id); }} onAddTable={() => { dialogs.close('nodeMenu'); dialogs.set('tableCreateParentId', nodeMenu.id); }} onMove={() => { dialogs.set('movingNode', nodeMenu); dialogs.close('nodeMenu'); }} onToggleBottomNav={nodeMenu.type === 'table' && nodeMenu.tableId ? () => { const tableId = nodeMenu.tableId!; const current = data.bottomNavigationTableIds ?? []; const isIncluded = current.includes(tableId); if (!isIncluded && current.length >= MAX_BOTTOM_NAVIGATION_TABLES) { setNotice(`底部導覽列最多 ${MAX_BOTTOM_NAVIGATION_TABLES} 張表格`); dialogs.close('nodeMenu'); return; } const next = isIncluded ? current.filter((id) => id !== tableId) : [...current, tableId]; commit({ ...data, bottomNavigationTableIds: next }); setNotice(isIncluded ? `已取消「${nodeMenu.name}」的底部導覽` : `已將「${nodeMenu.name}」加入底部導覽列`); dialogs.close('nodeMenu'); } : undefined} isInBottomNav={nodeMenu.type === 'table' && Boolean(nodeMenu.tableId && (data.bottomNavigationTableIds ?? []).includes(nodeMenu.tableId))} />}
    {movingNode && <MoveNodeDialog node={movingNode} data={data} onClose={() => dialogs.close('movingNode')} onMove={(parentId) => actions.relocateNode(movingNode, parentId)} />}
     {columnVisibilityOpen && table && <ColumnVisibilityDialog columns={table.columns} onClose={() => dialogs.close('columnVisibilityOpen')} onToggle={toggleColumnVisibility} />}
    {bottomNavigationDraft !== undefined && <WorkspaceBottomNavigationDialog tables={navigationTables} tableIds={bottomNavigationDraft} onChange={value => dialogs.set('bottomNavigationDraft', value)} onClose={closeBottomNavigationDialog} />}
    {filter.filterTarget && <HeaderFilterDialog key={`${filter.filterTarget.axis}:${filter.filterTarget.id}`} label={filter.filterTarget.label} inputType={filter.activeFilterInputType} options={filter.activeFilterOptions} numericValues={filter.activeNumericValues} state={filter.activeFilterState} onClose={() => filter.setFilterTarget(undefined)} onSort={filter.setActiveFilterSort} onToggle={filter.toggleActiveFilterOption} onSelectAll={() => filter.updateActiveFilter((state) => ({ ...state, includedKeys: null }))} onClearAll={() => filter.updateActiveFilter((state) => ({ ...state, includedKeys: [] }))} onQuery={filter.setActiveFilterQuery} onRange={filter.setActiveFilterRange} onDateRange={filter.setActiveDateRange} onClearDate={filter.clearActiveDateRange} onAggregate={filter.setActiveFilterAggregate} />}
    {tableCreateParentId !== undefined && <TableCreateDialog onClose={() => dialogs.close('tableCreateParentId')} onCreate={() => { const parentId = tableCreateParentId; dialogs.close('tableCreateParentId'); actions.addTable(parentId); }} onImport={() => { actions.importTableParentId.current = tableCreateParentId; actions.chooseImport('table'); }} />}
    {nameDialog && <NameDialog state={nameDialog} onClose={() => dialogs.close('nameDialog')} onSubmit={actions.submitName} />}
    {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} onClose={() => dialogs.close('confirmDialog')} onConfirm={confirmDialog.onConfirm} />}
    {activeEditingRow && activeEditingColumn && (activeEditingColumn.inputType === 'link'
      ? <LinkInputDialog column={activeEditingColumn} value={activeEditingValue} onDelete={activeEditingColumn.id === rowHeader?.id ? () => { dialogs.close('editing'); actions.askDeleteRow(activeEditingRow, activeEditingRowIndex); } : undefined} onSave={(next) => actions.saveCellValue(activeEditingRow.id, activeEditingColumn, next)} />
      : <CellInputDialog column={activeEditingColumn} value={activeEditingValue} inputLabel={activeEditingColumn.id === rowHeader?.id ? '物件名稱' : undefined} onDelete={activeEditingColumn.id === rowHeader?.id ? () => { dialogs.close('editing'); actions.askDeleteRow(activeEditingRow, activeEditingRowIndex); } : undefined} onDismiss={() => dialogs.close('editing')} onSave={(next) => actions.updateCell(activeEditingRow.id, activeEditingColumn, next)} />)}
     {configuring && <ColumnConfig column={configuring.column} suggestedOptions={fixedListSuggestions} onSave={actions.saveColumn} onDelete={configuring.isRowHeader ? undefined : () => { actions.askDeleteColumn(configuring.column); dialogs.close('configuring'); }} />}
     {selectionEditor && <WorkspaceSelectionDialog column={selectionEditor.column} value={selectionEditor.value} options={selectionEditor.options} onClose={() => dialogs.close('selectionEditor')} onSelect={actions.selectCellValue} onChange={selectionEditor.column.isMultiple ? actions.selectCellValue : undefined} />}
     {bulk.bulkEditorOpen && bulkColumn && (bulkColumn.inputType === 'number'
       ? <WorkspaceBulkNumberDialog column={bulkColumn} rows={bulk.bulkRows.map((row, index) => ({ rowId: row.id, label: (rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : displayWorkspaceCellValue(row.name)) || `第 ${index + 1} 個物件` }))} initialTotal={typeof bulk.bulkDraftValue === 'number' ? bulk.bulkDraftValue : null} onClose={() => bulk.setBulkEditorOpen(false)} onConfirm={(result) => { bulk.setBulkEditorOpen(false); if (result) bulk.commitBulkSelection({ sharedValue: result.total, distributedValues: result.values }); }} />
       : bulkColumn.inputType === 'link'
       ? <LinkInputDialog owner="bulk-editor" column={bulkColumn} value={bulk.bulkDraftValue} showConfirm onDismiss={() => bulk.setBulkEditorOpen(false)} onSave={(value) => bulk.commitBulkSelection({ sharedValue: value })} />
       : bulkColumn.inputType === 'select' || bulkColumn.inputType === 'dynamic-select'
       ? bulkColumn.isMultiple
         ? <WorkspaceBulkMultiSelectDialog column={bulkColumn} rows={bulk.bulkMultiSelectRows} options={bulkColumn.inputType === 'dynamic-select' && table ? getDynamicOptions(table, bulkColumn.id) : bulkColumn.options} onClose={() => bulk.setBulkEditorOpen(false)} onConfirm={(intents) => { bulk.setBulkEditorOpen(false); bulk.commitBulkCellUpdates(applyWorkspaceMultiSelectBatch(bulk.bulkMultiSelectRows, intents)); }} />
         : <WorkspaceSelectionDialog owner="bulk-editor" column={bulkColumn} value={bulk.bulkDraftValue} options={bulkColumn.inputType === 'dynamic-select' && table ? getDynamicOptions(table, bulkColumn.id) : bulkColumn.options} onClose={() => bulk.setBulkEditorOpen(false)} onConfirm={(value) => bulk.commitBulkSelection({ sharedValue: coerceCellValue(bulkColumn, value) })} />
       : <CellInputDialog owner="bulk-editor" column={bulkColumn} value={bulk.bulkDraftValue} inputLabel={`${bulkColumn.name}批次輸入`} showConfirm onDismiss={() => bulk.setBulkEditorOpen(false)} onSave={(value) => bulk.commitBulkSelection({ sharedValue: coerceCellValue(bulkColumn, value) })} />)}
     {hiddenFieldsEditor && hiddenEditorRow && <HiddenFieldsDialog title={hiddenFieldsEditor.title} row={hiddenEditorRow} columns={hiddenColumns} optionsByColumn={hiddenOptionsByColumn} onSave={(values) => saveHiddenFields(hiddenFieldsEditor.rowId, values)} />}
    {pasteDialogOpen && pasteTarget && <WorkspacePasteDialog targetLabel={pasteTargetLabel} onClose={() => dialogs.close('pasteDialogOpen')} onApply={pasteMatrix} />}
    {tableImportPreview && <WorkspaceTableImportPreviewDialog table={tableImportPreview.table} source={tableImportPreview.source} onClose={() => dialogs.close('tableImportPreview')} onImport={(tableCopy) => actions.finishTableImport(tableCopy, tableImportPreview.parentId)} />}
    {workspaceImport && <WorkspaceModal owner="workspace-import" title="匯入整個資料庫" onRequestClose={() => dialogs.close('workspaceImport')} className="workspace-import-preview-dialog"><div className="workspace-import-summary"><strong>{workspaceImport.tables.length} 張表格 · {workspaceImport.nodes.filter((node) => node.type === 'folder').length} 個資料夾</strong><span>{workspaceImport.tables.reduce((total, item) => total + item.rows.length, 0)} 個物件</span></div><div className="workspace-import-table-names">{workspaceImport.tables.map((item) => <span key={item.id}>{item.name}</span>)}</div><div className="workspace-import-actions"><button type="button" className="workspace-dialog-button secondary" onClick={() => actions.finishWorkspaceImport('merge')}>合併</button><button type="button" className="workspace-dialog-button danger" onClick={() => actions.finishWorkspaceImport('replace')}>取代</button></div></WorkspaceModal>}
    {driveBackup.dialogOpen && <GoogleDriveBackupDialog status={driveBackup.status} busy={driveBackup.busy} message={driveBackup.message} error={driveBackup.error} record={driveBackup.record} remoteFile={driveBackup.remoteFile} remoteConflict={driveBackup.remoteConflict} authorized={driveBackup.authorized} onClose={driveBackup.close} onConnect={() => void driveBackup.connect()} onBackup={() => void driveBackup.backup()} onFindRemote={() => void driveBackup.findRemote()} onRestore={() => void driveBackup.restore()} onOverwrite={() => void driveBackup.backup({ force: true })} onDisconnect={() => void driveBackup.disconnect()} />}
  </section></WorkspaceModalCloseContext.Provider></WorkspaceInputModalityContext.Provider>;
};
