import type { Dispatch, PointerEvent, RefObject, SetStateAction } from 'react';
import { useMemo } from 'react';
import { type WorkspaceBulkSelection } from './bulkEdit';
import type { WorkspaceTableHistory } from './history';
import { displayWorkspaceColumnValue, parseMultiSelectValues, workspaceCellColor, workspaceOptionColor } from './model';
import { isPendingWorkspaceRow } from './rowPages';
import type { WorkspaceColumn, WorkspaceNode, WorkspaceRow, WorkspaceTable } from './types';
import type { WorkspaceDialogController } from './useWorkspaceDialogs';
import { WorkspaceQuickActionPanel } from './WorkspaceQuickActionPanel';
import type { TableReorderKind, TableReorderVisual } from './workspaceShared';
import { ExternalLinkAction, overflowClassName, WorkspaceHeaderContent, WorkspaceIcon } from './workspaceShared';

const workspaceCellKey = (rowId: string, columnId: string) => `${rowId}:${columnId}`;

const workspaceLineLimitStyle = (column: WorkspaceColumn) => ({ '--workspace-line-limit': column.lineLimit ? String(column.lineLimit) : undefined } as React.CSSProperties);

interface WorkspaceTableViewOptions {
  table: WorkspaceTable | undefined;
  tableNode: WorkspaceNode | undefined;
  viewportRef: RefObject<HTMLDivElement | null>;
  panning: boolean;
  handleTableViewportScroll: (source: HTMLDivElement) => void;
  viewInteractionRef: RefObject<string | undefined>;
  stableBeginTablePan: (event: PointerEvent<HTMLDivElement>) => void;
  stableMoveTableReorder: (event: PointerEvent<HTMLDivElement>) => boolean;
  stableMoveTablePan: (event: PointerEvent<HTMLDivElement>) => void;
  stableEndTableReorder: (event: PointerEvent<HTMLDivElement>) => boolean;
  stableEndTablePan: (event: PointerEvent<HTMLDivElement>) => void;
  consumeSuppressedTableClick: (event: React.MouseEvent<HTMLDivElement>) => boolean;
  textScale: number;
  topRowRevealCount: number;
  renderedTableWidth: number;
  renderedColumnWidths: number[];
  rowHeader: WorkspaceColumn | undefined;
  configuring: { column: WorkspaceColumn; isRowHeader: boolean; } | undefined;
  activeCellColumnId: string | undefined;
  readyControls: { configure: (column: WorkspaceColumn, isRowHeader: boolean) => void; quickActions: () => void; };
  displayedColumns: WorkspaceColumn[];
  tableReorderVisual: TableReorderVisual | undefined;
  bulkSelection: WorkspaceBulkSelection | undefined;
  stableBeginTableReorder: (kind: TableReorderKind, sourceId: string, event: PointerEvent<HTMLElement>) => void;
  hasHiddenColumns: boolean;
  rowWindow: { virtual: boolean; first: number; last: number; visibleRows: readonly WorkspaceRow[]; topPadding: number; bottomPadding: number; measureRow: (id: string, height: number) => void; offsetForRow: (id: string) => number | undefined; pendingScrollTop: number | undefined; pendingStickToBottom: boolean; consumePendingScrollTop: () => void; };
  tableRowIndexes: Map<string, number>;
  activeCellRowId: string | undefined;
  bulkSelectedRowIds: Set<string>;
  setActiveCellElement: (element: HTMLElement | null) => void;
  updateDialogs: WorkspaceDialogController['update'];
  stableOpenCell: (row: WorkspaceRow, column: WorkspaceColumn) => void;
  activeCellKey: string | undefined;
  handleDataCellClick: (row: WorkspaceRow, column: WorkspaceColumn) => void;
  stableOpenHiddenFields: (row: WorkspaceRow) => void;
  quickActionsExpanded: boolean;
  currentTableHistory: WorkspaceTableHistory | undefined;
  setQuickActionsExpanded: Dispatch<SetStateAction<boolean>>;
  addRow: () => void;
  undoTable: () => void;
  redoTable: () => void;
  addColumn: () => void;
  stableApplyTextScale: (scale: number, persist?: boolean) => void;
  localMinTextScale: number;
}

export const useWorkspaceTableView = ({ table, tableNode, viewportRef, panning, handleTableViewportScroll, viewInteractionRef, stableBeginTablePan, stableMoveTableReorder, stableMoveTablePan, stableEndTableReorder, stableEndTablePan, consumeSuppressedTableClick, textScale, topRowRevealCount, renderedTableWidth, renderedColumnWidths, rowHeader, configuring, activeCellColumnId, readyControls, displayedColumns, tableReorderVisual, bulkSelection, stableBeginTableReorder, hasHiddenColumns, rowWindow, tableRowIndexes, activeCellRowId, bulkSelectedRowIds, setActiveCellElement, updateDialogs, stableOpenCell, activeCellKey, handleDataCellClick, stableOpenHiddenFields, quickActionsExpanded, currentTableHistory, setQuickActionsExpanded, addRow, undoTable, redoTable, addColumn, stableApplyTextScale, localMinTextScale }: WorkspaceTableViewOptions) => {
  const workspaceTableView = useMemo(() => {
    if (!table || !tableNode) return null;
    return <>
      <div ref={viewportRef} className={`workspace-table-viewport ${panning ? 'is-panning' : ''}`} onScroll={(event) => handleTableViewportScroll(event.currentTarget)} onPointerDown={(event) => { viewInteractionRef.current = table.id; stableBeginTablePan(event); }} onPointerMove={(event) => { if (!stableMoveTableReorder(event)) stableMoveTablePan(event); }} onPointerUp={(event) => { if (!stableEndTableReorder(event)) stableEndTablePan(event); }} onPointerCancel={(event) => { if (!stableEndTableReorder(event)) stableEndTablePan(event); }} onClickCapture={(event) => { if (consumeSuppressedTableClick(event)) { event.preventDefault(); event.stopPropagation(); } }}>
        <table className="workspace-table" style={{ '--workspace-text-scale': textScale, '--workspace-table-body-offset': topRowRevealCount ? `calc(var(--workspace-toolbar-row-height) * ${topRowRevealCount})` : '0px', width: `${renderedTableWidth}px` } as React.CSSProperties}>
          <colgroup>{renderedColumnWidths.map((width, index) => <col key={index} style={{ width: `${width}px` }} />)}</colgroup>
          <thead><tr>
            {rowHeader && <th className={`workspace-row-corner ${overflowClassName(rowHeader)} ${configuring?.isRowHeader ? 'is-editing' : ''}${activeCellColumnId === rowHeader.id ? ' workspace-context-active' : ''}`} style={{ textAlign: 'center', ...workspaceLineLimitStyle(rowHeader) }} onClick={() => readyControls.configure(rowHeader, true)}><WorkspaceHeaderContent label={rowHeader.name} nameClass="workspace-row-axis-name" /></th>}
            {displayedColumns.map((column) => {
              const isSource = tableReorderVisual?.kind === 'column' && tableReorderVisual.sourceId === column.id;
              const isTarget = tableReorderVisual?.kind === 'column' && tableReorderVisual.targetId === column.id;
              return <th key={column.id} data-column-id={column.id} className={`${overflowClassName(column)} ${bulkSelection?.columnId === column.id ? 'is-bulk-column ' : ''}${configuring?.column.id === column.id && !configuring.isRowHeader ? 'is-editing ' : ''}${activeCellColumnId === column.id ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: 'center', ...workspaceLineLimitStyle(column) }} onPointerDown={(event) => stableBeginTableReorder('column', column.id, event)} onClick={() => readyControls.configure(column, false)} onContextMenu={(event) => { event.preventDefault(); }}><WorkspaceHeaderContent label={column.name} nameClass="workspace-column-name" /></th>;
            })}
            {hasHiddenColumns && <th className="workspace-hidden-columns-heading" aria-label="隱藏欄位"><WorkspaceIcon name="eye-off" size={17} /></th>}
          </tr></thead>
          <tbody>
            {rowWindow.topPadding > 0 && <tr className="workspace-virtual-spacer" aria-hidden="true"><td colSpan={renderedColumnWidths.length} style={{ height: rowWindow.topPadding }} /></tr>}
            {rowWindow.visibleRows.map((row) => {
            if (isPendingWorkspaceRow(row)) return <tr key={row.id} className="workspace-virtual-spacer" aria-hidden="true"><td colSpan={renderedColumnWidths.length} style={{ height: 36 }} /></tr>;
            const originalIndex = tableRowIndexes.get(row.id) ?? -1;
            const rowLabel = displayWorkspaceColumnValue(row.name, rowHeader!);
            const rowAccessibleLabel = rowLabel || `第 ${originalIndex + 1} 個物件`;
            const isSource = tableReorderVisual?.kind === 'row' && tableReorderVisual.sourceId === row.id;
            const isTarget = tableReorderVisual?.kind === 'row' && tableReorderVisual.targetId === row.id;
            const isRowHeaderActive = activeCellRowId === row.id && activeCellColumnId === rowHeader?.id;
            const isActiveRow = activeCellRowId === row.id || bulkSelectedRowIds.has(row.id);
            return <tr key={row.id} data-virtual-row-id={row.id}>
              {rowHeader && <th scope="row" data-row-id={row.id} data-cell-id={workspaceCellKey(row.id, rowHeader.id)} ref={isRowHeaderActive ? setActiveCellElement : undefined} className={`workspace-row-heading ${overflowClassName(rowHeader)} ${isRowHeaderActive ? 'is-editing ' : ''}${isActiveRow ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: rowHeader.alignment ?? 'left', ...workspaceLineLimitStyle(rowHeader) }} onPointerDown={(event) => stableBeginTableReorder('row', row.id, event)} onClick={() => { updateDialogs({ lastPasteTarget: { rowId: row.id, columnId: rowHeader.id } }); stableOpenCell(row, rowHeader); }} onContextMenu={(event) => { event.preventDefault(); }}><div className="workspace-cell-layout"><button type="button" className="workspace-row-name" aria-label={`編輯物件 ${rowAccessibleLabel}`}><span className="workspace-cell-value" style={{ color: workspaceCellColor(rowHeader, row.name) }}>{rowLabel}</span></button><ExternalLinkAction value={row.name} pushWidth={rowHeader.inputType === 'link' && rowHeader.overflowMode === 'expand'} /></div></th>}
              {displayedColumns.map((column) => {
                const value = row.values[column.id] ?? null;
                const displayValue = displayWorkspaceColumnValue(value, column);
                const isActive = activeCellKey === workspaceCellKey(row.id, column.id);
                const multiChips = column.isMultiple && typeof value === 'string' ? parseMultiSelectValues(value) : [];
                const isBulkSelected = bulkSelection?.columnId === column.id && bulkSelectedRowIds.has(row.id);
                return <td key={column.id} data-bulk-row-id={row.id} data-bulk-column-id={column.id} data-cell-id={workspaceCellKey(row.id, column.id)} ref={isActive ? setActiveCellElement : undefined} className={`${overflowClassName(column)} ${bulkSelection?.columnId === column.id ? 'is-bulk-column ' : ''}${isActive ? 'is-editing ' : ''}${isBulkSelected ? 'is-bulk-selected' : ''}`} style={{ textAlign: column.alignment ?? 'left', ...workspaceLineLimitStyle(column) }} aria-label={`${rowAccessibleLabel}，${column.name || '未命名屬性'}：${displayValue || '空白'}`} aria-selected={isBulkSelected} onClick={() => handleDataCellClick(row, column)}>
                  <div className="workspace-cell-layout">
                    {multiChips.length > 0 ? (
                      <div className="workspace-multi-chip-list workspace-cell-value">
                        {multiChips.map((chip, idx) => <span key={idx} className="workspace-multi-chip" style={{ color: workspaceOptionColor(column, chip) }}>{chip}</span>)}
                      </div>
                    ) : (
                      <span className={`workspace-cell-value ${displayValue ? '' : 'workspace-empty-cell'}`} style={{ color: workspaceCellColor(column, value) }}>{displayValue}</span>
                    )}
                    <ExternalLinkAction value={value} pushWidth={column.inputType === 'link' && column.overflowMode === 'expand'} />
                  </div>
                </td>;
              })}
              {hasHiddenColumns && <td className="workspace-hidden-columns-cell"><button type="button" className="workspace-hidden-fields-trigger" aria-label={`編輯 ${rowAccessibleLabel} 的隱藏欄位`} onClick={(event) => { event.stopPropagation(); stableOpenHiddenFields(row); }}><WorkspaceIcon name="chevron" size={20} /></button></td>}
            </tr>;
          })}
            {rowWindow.bottomPadding > 0 && <tr className="workspace-virtual-spacer" aria-hidden="true"><td colSpan={renderedColumnWidths.length} style={{ height: rowWindow.bottomPadding }} /></tr>}
          </tbody>
        </table>
        <WorkspaceQuickActionPanel
          expanded={quickActionsExpanded}
          canUndo={Boolean(currentTableHistory?.past.length)}
          canRedo={Boolean(currentTableHistory?.future.length)}
          undoTitle={currentTableHistory?.past.at(-1) ? `復原：${currentTableHistory.past.at(-1)!.label}` : '沒有可復原的操作'}
          redoTitle={currentTableHistory?.future.at(-1) ? `重做：${currentTableHistory.future.at(-1)!.label}` : '沒有可重做的操作'}
          onExpand={readyControls.quickActions}
          onCollapse={() => setQuickActionsExpanded(false)}
          onAddRow={addRow}
          onUndo={undoTable}
          onRedo={redoTable}
          onAddColumn={addColumn}
        />
      </div>
      <div className="workspace-zoom-indicator"><button type="button" onClick={() => stableApplyTextScale(textScale - 0.1)} aria-label="縮小文字">−</button><span>{Math.round(textScale * 100)}%</span><button type="button" onClick={() => stableApplyTextScale(textScale + 0.1)} aria-label="放大文字">＋</button><button type="button" onClick={() => stableApplyTextScale(localMinTextScale)} aria-label="縮到可完整顯示屬性">適合寬度</button></div>
    </>;
  }, [activeCellColumnId, activeCellKey, activeCellRowId, addColumn, addRow, bulkSelectedRowIds, bulkSelection, configuring, consumeSuppressedTableClick, currentTableHistory, displayedColumns, handleDataCellClick, handleTableViewportScroll, hasHiddenColumns, localMinTextScale, panning, quickActionsExpanded, redoTable, renderedColumnWidths, renderedTableWidth, rowHeader, rowWindow.visibleRows, rowWindow.topPadding, rowWindow.bottomPadding, setActiveCellElement, readyControls, stableApplyTextScale, stableBeginTablePan, stableBeginTableReorder, stableEndTablePan, stableEndTableReorder, stableMoveTablePan, stableMoveTableReorder, stableOpenCell, stableOpenHiddenFields, table, tableNode, tableRowIndexes, tableReorderVisual, textScale, topRowRevealCount, undoTable, updateDialogs, viewportRef, viewInteractionRef]);

  return { workspaceTableView };
};
