import { useEffect, useRef, useState } from 'react';
import type { WorkspaceData, WorkspaceTable } from './types';
import type { TableReorderKind, TableReorderSession, TableReorderVisual } from './workspaceShared';
import { reorderBeforeOrAfter, tableReorderHoldMs, updateTable } from './workspaceShared';
import { applyTableBounce, getTableContentScrollBounds, getTablePanAxis, resetTableBounce, settleTableBounce, useMomentumScroll, TablePanAxis } from './useMomentumScroll';
import { useTableZoom } from './useTableZoom';

export const TABLE_BOUNDARY_SEARCH_HOLD_MS = 500;

interface UseTableGesturesProps {
  table: WorkspaceTable | undefined;
  data: WorkspaceData | undefined;
  commit: (next: WorkspaceData) => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  workspacePageRef: React.RefObject<HTMLElement | null>;
  setNotice: (msg: string) => void;
  minTextScale: number;
  onCellLongPress?: (rowId: string, columnId: string) => void;
  onOpenDrawer?: () => void;
  onOpenSearch?: () => void;
  searchOpen?: boolean;
}

export const getTableBoundarySearchEdge = (startScrollTop: number, targetScrollTop: number, maxTop: number, deltaY: number, axis?: TablePanAxis): 'top' | 'bottom' | undefined => {
  if (axis !== 'y' || maxTop <= 0) return undefined;
  if (startScrollTop <= 0 && targetScrollTop < 0 && deltaY > 0) return 'top';
  if (startScrollTop >= maxTop && targetScrollTop > maxTop && deltaY < 0) return 'bottom';
  return undefined;
};

export function useTableGestures({ table, data, commit, viewportRef, workspacePageRef, setNotice, minTextScale, onCellLongPress, onOpenDrawer, onOpenSearch, searchOpen = false }: UseTableGesturesProps) {
  const [panning, setPanning] = useState(false);
  const [tableReorderVisual, setTableReorderVisual] = useState<TableReorderVisual>();

  const dataRef = useRef<WorkspaceData | undefined>(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  const {
    textScale,
    setTextScale,
    textScaleRef,
    applyTextScale,
    pendingScaleSave,
    flushPendingTextScale,
  } = useTableZoom({ table, data, commit, workspacePageRef, minTextScale });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | undefined>(undefined);
  const panStart = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | undefined>(undefined);
  const panAxis = useRef<TablePanAxis | undefined>(undefined);
  const panMetrics = useRef<{ table: HTMLTableElement | null; bounds: ReturnType<typeof getTableContentScrollBounds> } | undefined>(undefined);
  const pointerMoved = useRef(false);
  const ignoreNextTableClick = useRef(false);
  const cellHold = useRef<{ pointerId: number; startX: number; startY: number; timer?: number; active: boolean } | undefined>(undefined);
  const drawerSwipe = useRef<{ pointerId: number; startX: number; startY: number; triggered: boolean } | undefined>(undefined);
  const boundarySearchHold = useRef<{ pointerId: number; edge: 'top' | 'bottom'; timer?: number; triggered: boolean } | undefined>(undefined);
  
  const tableReorderSession = useRef<TableReorderSession | undefined>(undefined);
  const tableReorderPointer = useRef<{ session: TableReorderSession; x: number; y: number } | undefined>(undefined);
  const tableReorderAutoScrollFrame = useRef<number | undefined>(undefined);

  const momentumScroll = useMomentumScroll();

  const clearBoundarySearchHold = () => {
    if (boundarySearchHold.current?.timer !== undefined) window.clearTimeout(boundarySearchHold.current.timer);
    boundarySearchHold.current = undefined;
  };

  const armBoundarySearchHold = (pointerId: number, edge: 'top' | 'bottom') => {
    if (!onOpenSearch || searchOpen) {
      clearBoundarySearchHold();
      return;
    }
    const current = boundarySearchHold.current;
    if (current?.pointerId === pointerId && current.edge === edge) return;
    clearBoundarySearchHold();
    const hold: { pointerId: number; edge: 'top' | 'bottom'; timer?: number; triggered: boolean } = { pointerId, edge, triggered: false };
    hold.timer = window.setTimeout(() => {
      if (boundarySearchHold.current !== hold || hold.triggered) return;
      hold.triggered = true;
      momentumScroll.stop();
      panStart.current = undefined;
      panAxis.current = undefined;
      panMetrics.current = undefined;
      pointerMoved.current = true;
      setPanning(false);
      ignoreNextTableClick.current = true;
      window.setTimeout(() => { ignoreNextTableClick.current = false; }, 120);
      onOpenSearch();
    }, TABLE_BOUNDARY_SEARCH_HOLD_MS);
    boundarySearchHold.current = hold;
  };

  const updateTableReorderTarget = (session: TableReorderSession, clientX: number, clientY: number) => {
    const selector = session.kind === 'row' ? '[data-row-id]' : '[data-column-id]';
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(selector);
    const targetId = target?.dataset[session.kind === 'row' ? 'rowId' : 'columnId'];
    if (!target || !targetId) return;
    const rect = target.getBoundingClientRect();
    const horizontal = table?.transposed ? session.kind === 'row' : session.kind === 'column';
    session.targetId = targetId;
    session.after = horizontal ? clientX > rect.left + rect.width / 2 : clientY > rect.top + rect.height / 2;
    setTableReorderVisual({ kind: session.kind, sourceId: session.sourceId, targetId, after: session.after });
  };

  const stopTableReorderAutoScroll = () => {
    if (tableReorderAutoScrollFrame.current !== undefined) window.cancelAnimationFrame(tableReorderAutoScrollFrame.current);
    tableReorderAutoScrollFrame.current = undefined;
  };

  const runTableReorderAutoScroll = () => {
    tableReorderAutoScrollFrame.current = undefined;
    const pointer = tableReorderPointer.current;
    const session = tableReorderSession.current;
    const viewport = viewportRef.current;
    if (!pointer || !session || pointer.session !== session || !session.active || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const edge = Math.min(64, Math.max(32, Math.min(rect.width, rect.height) / 3));
    const speed = (distance: number) => Math.min(18, Math.max(3, (edge - distance) / 2));
    const canScrollLeft = viewport.scrollLeft > 0;
    const canScrollRight = viewport.scrollLeft < viewport.scrollWidth - viewport.clientWidth;
    const canScrollUp = viewport.scrollTop > 0;
    const canScrollDown = viewport.scrollTop < viewport.scrollHeight - viewport.clientHeight;
    const horizontal = table?.transposed ? session.kind === 'row' : session.kind === 'column';
    const deltaX = horizontal
      ? pointer.x < rect.left + edge && canScrollLeft
        ? -speed(pointer.x - rect.left)
        : pointer.x > rect.right - edge && canScrollRight
          ? speed(rect.right - pointer.x)
          : 0
      : 0;
    const deltaY = horizontal
      ? 0
      : pointer.y < rect.top + edge && canScrollUp
        ? -speed(pointer.y - rect.top)
        : pointer.y > rect.bottom - edge && canScrollDown
          ? speed(rect.bottom - pointer.y)
          : 0;
    if (!deltaX && !deltaY) return;
    viewport.scrollLeft += deltaX;
    viewport.scrollTop += deltaY;
    updateTableReorderTarget(session, pointer.x, pointer.y);
    tableReorderAutoScrollFrame.current = window.requestAnimationFrame(runTableReorderAutoScroll);
  };

  const updateTableReorderAutoScroll = () => {
    if (tableReorderAutoScrollFrame.current === undefined) tableReorderAutoScrollFrame.current = window.requestAnimationFrame(runTableReorderAutoScroll);
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
        tableReorderPointer.current = undefined;
      }
      return false;
    }
    tableReorderPointer.current = { session, x: event.clientX, y: event.clientY };
    updateTableReorderTarget(session, event.clientX, event.clientY);
    updateTableReorderAutoScroll();
    event.preventDefault();
    return true;
  };

  const endTableReorder = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = tableReorderSession.current;
    if (!session || session.pointerId !== event.pointerId) return false;
    if (session.timer) window.clearTimeout(session.timer);
    stopTableReorderAutoScroll();
    tableReorderPointer.current = undefined;
    tableReorderSession.current = undefined;
    drawerSwipe.current = undefined;
    setTableReorderVisual(undefined);
    if (!session.active) return false;
    const currentData = dataRef.current;
    if (currentData && table && session.sourceId !== session.targetId) {
      commit(updateTable(currentData, table.id, (current) => ({
        ...current,
        updatedAt: Date.now(),
        ...(session.kind === 'row'
          ? { rows: reorderBeforeOrAfter(current.rows, session.sourceId, session.targetId, session.after) }
          : { columns: reorderBeforeOrAfter(current.columns, session.sourceId, session.targetId, session.after) }),
      })));
      setNotice(session.kind === 'row' ? '已調整物件順序' : '已調整屬性順序');
    }
    ignoreNextTableClick.current = true;
    window.setTimeout(() => { ignoreNextTableClick.current = false; }, 120);
    event.preventDefault();
    return true;
  };

  const beginTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    momentumScroll.stop();
    clearBoundarySearchHold();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest('input, textarea')) return;
    const viewport = event.currentTarget;
    panMetrics.current = undefined;
    if (pointers.current.size === 0 && event.pointerType !== 'mouse' && onOpenDrawer) {
      const firstColumn = (event.target as Element).closest<HTMLElement>('.workspace-row-heading');
      const firstColumnRect = firstColumn?.getBoundingClientRect();
      drawerSwipe.current = firstColumnRect && event.clientX <= firstColumnRect.left + firstColumnRect.width / 2
        ? { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, triggered: false }
        : undefined;
    } else if (pointers.current.size > 0) {
      drawerSwipe.current = undefined;
    }
    if (pointers.current.size === 0 && onCellLongPress) {
      const cell = (event.target as Element).closest<HTMLTableCellElement>('td[data-bulk-row-id][data-bulk-column-id]');
      const rowId = cell?.dataset.bulkRowId;
      const columnId = cell?.dataset.bulkColumnId;
      if (rowId && columnId) {
        const hold: { pointerId: number; startX: number; startY: number; timer?: number; active: boolean } = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
        hold.timer = window.setTimeout(() => {
          if (cellHold.current !== hold) return;
          hold.active = true;
          pointers.current.clear();
          panStart.current = undefined;
          pinchStart.current = undefined;
          setPanning(false);
          ignoreNextTableClick.current = true;
          onCellLongPress(rowId, columnId);
        }, tableReorderHoldMs);
        cellHold.current = hold;
      }
    } else if (cellHold.current?.timer) {
      window.clearTimeout(cellHold.current.timer);
      cellHold.current = undefined;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointerMoved.current = false;
    if (pointers.current.size === 1) {
      panStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
      panAxis.current = undefined;
      pinchStart.current = undefined;
    } else if (pointers.current.size === 2) {
      clearBoundarySearchHold();
      const points = [...pointers.current.values()];
      if ('setPointerCapture' in viewport) {
        for (const pointerId of pointers.current.keys()) {
          try { viewport.setPointerCapture(pointerId); } catch { /* A pointer may already have been cancelled. */ }
        }
      }
      pinchStart.current = { distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)), scale: textScaleRef.current };
      panStart.current = undefined;
      panAxis.current = undefined;
      panMetrics.current = undefined;
    }
  };

  const moveTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drawerGesture = drawerSwipe.current;
    if (drawerGesture?.pointerId === event.pointerId) {
      const deltaX = event.clientX - drawerGesture.startX;
      const deltaY = event.clientY - drawerGesture.startY;
      if (drawerGesture.triggered) {
        event.preventDefault();
        return;
      }
      if (deltaX > 24 && deltaX > Math.abs(deltaY)) {
        drawerGesture.triggered = true;
        if (cellHold.current?.pointerId === event.pointerId) {
          if (cellHold.current.timer) window.clearTimeout(cellHold.current.timer);
          cellHold.current = undefined;
        }
        pointers.current.delete(event.pointerId);
        panStart.current = undefined;
        panAxis.current = undefined;
        panMetrics.current = undefined;
        pointerMoved.current = true;
        setPanning(false);
        momentumScroll.stop();
        ignoreNextTableClick.current = true;
        window.setTimeout(() => { ignoreNextTableClick.current = false; }, 120);
        onOpenDrawer?.();
        event.preventDefault();
        return;
      }
      if (Math.hypot(deltaX, deltaY) > 10 && (deltaX <= 0 || Math.abs(deltaY) >= deltaX)) drawerSwipe.current = undefined;
    }
    const hold = cellHold.current;
    if (hold?.pointerId === event.pointerId) {
      if (!hold.active && Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) > 8) {
        if (hold.timer) window.clearTimeout(hold.timer);
        cellHold.current = undefined;
      } else if (hold.active) {
        event.preventDefault();
        return;
      }
    }
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
        panAxis.current = getTablePanAxis(deltaX, deltaY);
        const table = viewport.querySelector('table');
        panMetrics.current = { table, bounds: getTableContentScrollBounds(viewport, table) };
        setPanning(true);
        if ('setPointerCapture' in viewport) {
          try { viewport.setPointerCapture(event.pointerId); } catch { /* The pointer may already have been cancelled. */ }
        }
      }
      momentumScroll.trackMove(event.clientX, event.clientY);
      const targetScrollLeft = panAxis.current === 'y' ? panStart.current.scrollLeft : panStart.current.scrollLeft - deltaX;
      const targetScrollTop = panAxis.current === 'x' ? panStart.current.scrollTop : panStart.current.scrollTop - deltaY;
      viewport.scrollLeft = targetScrollLeft;
      viewport.scrollTop = targetScrollTop;

      // Calculate visual elastic tension on inner <table> when dragging beyond viewport boundaries
      const fallbackTable = viewport.querySelector('table');
      const metrics = panMetrics.current ?? { table: fallbackTable, bounds: getTableContentScrollBounds(viewport, fallbackTable) };
      panMetrics.current = metrics;
      const { table } = metrics;
      if (table) {
        const { maxLeft, maxTop } = metrics.bounds;
        const beyondX = targetScrollLeft < 0 || targetScrollLeft > maxLeft;
        const beyondY = targetScrollTop < 0 || targetScrollTop > maxTop;
        const bounceAxis = panAxis.current === 'both'
          ? Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y'
          : panAxis.current;
        let overX = 0;
        let overY = 0;
        if (bounceAxis === 'x') {
          if (targetScrollLeft < 0) overX = Math.min(30, -targetScrollLeft * 0.35);
          else if (targetScrollLeft > maxLeft) overX = Math.max(-30, (maxLeft - targetScrollLeft) * 0.35);
        } else if (bounceAxis === 'y') {
          if (targetScrollTop < 0) overY = Math.min(30, -targetScrollTop * 0.35);
          else if (targetScrollTop > maxTop) overY = Math.max(-30, (maxTop - targetScrollTop) * 0.35);
        }

        if (overX !== 0 || overY !== 0) {
          applyTableBounce(table, overX, overY);
        } else if (table.classList.contains('is-bouncing') || table.style.transform !== '') {
          resetTableBounce(table);
        }

        const boundaryEdge = getTableBoundarySearchEdge(panStart.current.scrollTop, targetScrollTop, maxTop, deltaY, bounceAxis);
        if (boundaryEdge && event.pointerType !== 'mouse') armBoundarySearchHold(event.pointerId, boundaryEdge);
        else clearBoundarySearchHold();
      }

      event.preventDefault();
    }
  };

  const endTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drawerGesture = drawerSwipe.current;
    if (drawerGesture?.pointerId === event.pointerId) {
      drawerSwipe.current = undefined;
      if (drawerGesture.triggered) {
        event.preventDefault();
        return;
      }
    }
    const hold = cellHold.current;
    if (hold?.pointerId === event.pointerId) {
      if (hold.timer) window.clearTimeout(hold.timer);
      cellHold.current = undefined;
      if (hold.active) {
        pointers.current.delete(event.pointerId);
        panStart.current = undefined;
        pinchStart.current = undefined;
        panAxis.current = undefined;
        pointerMoved.current = false;
        setPanning(false);
        window.setTimeout(() => { ignoreNextTableClick.current = false; }, 0);
        event.preventDefault();
        return;
      }
    }
    if (!pointers.current.has(event.pointerId)) return;
    if (boundarySearchHold.current?.pointerId === event.pointerId) clearBoundarySearchHold();
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
      panMetrics.current = undefined;
    } else if (pointers.current.size > 1) {
      panStart.current = undefined;
      panMetrics.current = undefined;
    }
    if (pointers.current.size === 0) {
      const metrics = panMetrics.current;
      const table = metrics?.table ?? viewport.querySelector('table');
      if (table && (table.classList.contains('is-bouncing') || table.style.transform)) settleTableBounce(table);
      setPanning(false);
      momentumScroll.release(viewport, panAxis.current, metrics?.bounds);
      panMetrics.current = undefined;
      panAxis.current = undefined;
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

  useEffect(() => () => {
    if (cellHold.current?.timer) window.clearTimeout(cellHold.current.timer);
    if (tableReorderSession.current?.timer) window.clearTimeout(tableReorderSession.current.timer);
    if (tableReorderAutoScrollFrame.current !== undefined) window.cancelAnimationFrame(tableReorderAutoScrollFrame.current);
    if (boundarySearchHold.current?.timer !== undefined) window.clearTimeout(boundarySearchHold.current.timer);
    momentumScroll.stop();
  }, [momentumScroll.stop]);

  return {
    textScale, panning, tableReorderVisual, ignoreNextTableClick,
    setTextScale, applyTextScale,
    beginTableReorder, moveTableReorder, endTableReorder,
    beginTablePan, moveTablePan, endTablePan,
  };
}
