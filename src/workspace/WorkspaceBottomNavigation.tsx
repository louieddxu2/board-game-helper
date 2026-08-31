import { useRef, useState } from 'react';
import { WorkspaceIcon, WorkspaceModal } from './workspaceShared';

export interface WorkspaceBottomNavigationItem {
  tableId: string;
  nodeId: string;
  name: string;
}

export const reorderBottomNavigationTableIds = (tableIds: string[], sourceId: string, targetId: string, after = false) => {
  if (sourceId === targetId) return tableIds;
  const sourceIndex = tableIds.indexOf(sourceId);
  if (sourceIndex < 0) return tableIds;
  const next = tableIds.filter((tableId) => tableId !== sourceId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return tableIds;
  next.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
  return next;
};

export const WorkspaceBottomNavigation = ({ items, activeTableId, onOpen }: {
  items: WorkspaceBottomNavigationItem[];
  activeTableId?: string;
  onOpen(item: WorkspaceBottomNavigationItem): void;
}) => <nav className="workspace-bottom-navigation" aria-label="常用表格">
  {items.map((item) => <button
    key={item.tableId}
    type="button"
    className={item.tableId === activeTableId ? 'is-active' : ''}
    aria-current={item.tableId === activeTableId ? 'page' : undefined}
    aria-label={`開啟表格 ${item.name}`}
    title={item.name}
    onClick={() => onOpen(item)}
  >
    <WorkspaceIcon name="table" size={19} />
    <span>{item.name}</span>
  </button>)}
</nav>;

export const WorkspaceBottomNavigationDialog = ({ tables, tableIds, onChange, onClose }: {
  tables: WorkspaceBottomNavigationItem[];
  tableIds: string[];
  onChange(tableIds: string[]): void;
  onClose(): void;
}) => {
  const [draggingId, setDraggingId] = useState<string>();
  const dragRef = useRef<{ pointerId: number; sourceId: string; startY: number; active: boolean } | undefined>(undefined);
  const tableById = new Map(tables.map((item) => [item.tableId, item]));
  const pinnedItems = tableIds.flatMap((tableId) => tableById.get(tableId) ?? []);

  const beginDrag = (tableId: string, event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, sourceId: tableId, startY: event.clientY, active: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional in tests. */ }
  };
  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.abs(event.clientY - drag.startY) < 5) return;
    drag.active = true;
    setDraggingId(drag.sourceId);
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-bottom-navigation-table-id]');
    const targetId = target?.dataset.bottomNavigationTableId;
    if (!targetId || targetId === drag.sourceId) return;
    const after = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
    onChange(reorderBottomNavigationTableIds(tableIds, drag.sourceId, targetId, after));
  };
  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setDraggingId(undefined);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Pointer capture may already be gone. */ }
  };
  const moveWithKeyboard = (tableId: string, direction: -1 | 1) => {
    const index = tableIds.indexOf(tableId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= tableIds.length) return;
    const next = [...tableIds];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(next);
  };

  return <WorkspaceModal title="底部導覽列" dialogKind="editor" onClose={onClose} className="workspace-bottom-navigation-dialog">
    <div className="workspace-bottom-navigation-list" aria-label="已加入導覽的表格">
      {pinnedItems.map((item, index) => <div
        key={item.tableId}
        className={`workspace-bottom-navigation-setting-row${draggingId === item.tableId ? ' is-dragging' : ''}`}
        data-bottom-navigation-table-id={item.tableId}
      >
        <button
          type="button"
          className="workspace-bottom-navigation-drag"
          aria-label={`拖曳調整 ${item.name} 的順序`}
          onPointerDown={(event) => beginDrag(item.tableId, event)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); moveWithKeyboard(item.tableId, -1); }
            if (event.key === 'ArrowDown' && index < tableIds.length - 1) { event.preventDefault(); moveWithKeyboard(item.tableId, 1); }
          }}
        ><WorkspaceIcon name="more" size={22} /></button>
        <span>{item.name}</span>
        <button type="button" className="workspace-bottom-navigation-remove" onClick={() => onChange(tableIds.filter((tableId) => tableId !== item.tableId))}>取消導覽</button>
      </div>)}
      {pinnedItems.length === 0 && <p className="workspace-bottom-navigation-empty">尚未加入表格</p>}
    </div>
  </WorkspaceModal>;
};
