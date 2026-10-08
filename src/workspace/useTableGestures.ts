import { useCallback, useEffect, useRef, useState } from 'react';
import { canInitiateDrawerSwipe, CELL_SWEEP_CROSS_AXIS_DISTANCE, CELL_SWEEP_INTENT_DISTANCE, getTableBoundarySearchEdge, isCellSweepDirection, isInCellSweepLane, TABLE_BOUNDARY_SCROLL_TOLERANCE, TABLE_BOUNDARY_SEARCH_HOLD_MS } from './tableGestureGeometry';
import type { CellHoldSession, UseTableGesturesProps } from './tableGestureTypes';
import type { WorkspaceData } from './types';
import { DRAG_SCROLL_INTENT_DISTANCE, useDragEdgeAutoScroll } from './useDragEdgeAutoScroll';
import { applyTableBounce, getTableContentScrollBounds, getTablePanAxis, resetTableBounce, settleTableBounce, TablePanAxis, useMomentumScroll } from './useMomentumScroll';
import { useTableZoom } from './useTableZoom';
import type { TableReorderKind, TableReorderSession, TableReorderVisual } from './workspaceShared';
import { reorderBeforeOrAfter, tableReorderHoldMs, updateTable } from './workspaceShared';
export function useTableGestures({ table, data, commit, viewportRef, workspacePageRef, setNotice, minTextScale, onCellLongPress, onCellSweep, onCellTap, bulkSelectionColumnId, onDrawerSwipeProgress, onDrawerSwipeEnd, onOpenSearch, onRevealTopRow, searchOpen = false, ensureTableReady, onReadError, onPersistTextScale }: UseTableGesturesProps) {
  const [panning, setPanning] = useState(false);
  const [tableReorderVisual, setTableReorderVisual] = useState<TableReorderVisual>();

  const dataRef = useRef<WorkspaceData | undefined>(data);
  dataRef.current = data;
  const latest = useRef({ tableId: table?.id, onCellLongPress });
  latest.current = { tableId: table?.id, onCellLongPress };

  const {
    textScale,
    setTextScale,
    textScaleRef,
    applyTextScale,
    pendingScaleSave,
    flushPendingTextScale,
  } = useTableZoom({ table, data, commit, workspacePageRef, minTextScale, onPersistTextScale });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | undefined>(undefined);
  const panStart = useRef<{ pointerId: number; x: number; y: number; scrollLeft: number; scrollTop: number } | undefined>(undefined);
  const panAxis = useRef<TablePanAxis | undefined>(undefined);
  const panMetrics = useRef<{ table: HTMLTableElement | null; bounds: ReturnType<typeof getTableContentScrollBounds> } | undefined>(undefined);
  const pointerMoved = useRef(false);
  const ignoreNextTableClick = useRef(false);
  const ignoredTouchClickAt = useRef<{ x: number; y: number } | undefined>(undefined);
  const ignoreNextTableClickTimer = useRef<number | undefined>(undefined);
  const cellHold = useRef<CellHoldSession | undefined>(undefined);
  const drawerSwipe = useRef<{ pointerId: number; startX: number; startY: number; active: boolean; lastDeltaX: number } | undefined>(undefined);
  const boundarySearchHold = useRef<{ pointerId: number; edge: 'top' | 'bottom'; timer?: number; triggered: boolean } | undefined>(undefined);
  
  const tableReorderSession = useRef<TableReorderSession | undefined>(undefined);
  const reorderOwner = useRef<string | undefined>(undefined);
  const tableReorderPointer = useRef<{ session: TableReorderSession; x: number; y: number } | undefined>(undefined);

  const momentumScroll = useMomentumScroll();
  useEffect(() => {
    if (cellHold.current?.timer) window.clearTimeout(cellHold.current.timer);
    if (tableReorderSession.current?.timer) window.clearTimeout(tableReorderSession.current.timer);
    if (boundarySearchHold.current?.timer !== undefined) window.clearTimeout(boundarySearchHold.current.timer);
    cellHold.current = undefined; tableReorderSession.current = undefined;
    tableReorderPointer.current = undefined; boundarySearchHold.current = undefined;
    pointers.current.clear(); panStart.current = undefined; pinchStart.current = undefined; drawerSwipe.current = undefined;
    panMetrics.current = undefined; panAxis.current = undefined;
    momentumScroll.stop(); setPanning(false); setTableReorderVisual(undefined);
  }, [table?.id, momentumScroll.stop]);

  const clearBoundarySearchHold = () => {
    if (boundarySearchHold.current?.timer !== undefined) window.clearTimeout(boundarySearchHold.current.timer);
    boundarySearchHold.current = undefined;
  };

  const suppressNextTableClick = (duration: number, touchPoint?: { x: number; y: number }) => {
    if (ignoreNextTableClickTimer.current !== undefined) window.clearTimeout(ignoreNextTableClickTimer.current);
    ignoreNextTableClick.current = true;
    ignoredTouchClickAt.current = touchPoint;
    ignoreNextTableClickTimer.current = window.setTimeout(() => {
      ignoreNextTableClick.current = false;
      ignoredTouchClickAt.current = undefined;
      ignoreNextTableClickTimer.current = undefined;
    }, duration);
  };

  const consumeSuppressedTableClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!ignoreNextTableClick.current) return false;
    const touchPoint = ignoredTouchClickAt.current;
    if (touchPoint) {
      const click = event.nativeEvent as MouseEvent & { pointerType?: string; sourceCapabilities?: { firesTouchEvents?: boolean } };
      const fromTouch = click.pointerType === 'touch' || click.sourceCapabilities?.firesTouchEvents;
      if (!fromTouch && (click.pointerType === 'mouse' || Math.hypot(click.clientX - touchPoint.x, click.clientY - touchPoint.y) > 12)) return false;
    }
    if (ignoreNextTableClickTimer.current !== undefined) window.clearTimeout(ignoreNextTableClickTimer.current);
    ignoreNextTableClick.current = false;
    ignoredTouchClickAt.current = undefined;
    ignoreNextTableClickTimer.current = undefined;
    return true;
  }, []);

  useEffect(() => {
    if (bulkSelectionColumnId) clearBoundarySearchHold();
  }, [bulkSelectionColumnId]);

  const armBoundarySearchHold = (pointerId: number, edge: 'top' | 'bottom') => {
    if (!onOpenSearch || searchOpen || bulkSelectionColumnId) {
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
      suppressNextTableClick(120);
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
    const horizontal = session.kind === 'column';
    session.targetId = targetId;
    session.after = horizontal ? clientX > rect.left + rect.width / 2 : clientY > rect.top + rect.height / 2;
    setTableReorderVisual({ kind: session.kind, sourceId: session.sourceId, targetId, after: session.after });
  };

  const tableReorderAutoScroll = useDragEdgeAutoScroll({
    getContainer: () => viewportRef.current,
    onScroll: () => {
      const pointer = tableReorderPointer.current;
      const session = tableReorderSession.current;
      if (pointer && session && pointer.session === session) updateTableReorderTarget(session, pointer.x, pointer.y);
    },
  });

  const beginTableReorder = (kind: TableReorderKind, sourceId: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const session: TableReorderSession = { kind, sourceId, targetId: sourceId, after: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
    const owner = table?.id;
    reorderOwner.current = owner;
    session.timer = window.setTimeout(() => {
      const activate = () => {
        if (tableReorderSession.current !== session || latest.current.tableId !== owner) return;
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
      };
      if (ensureTableReady) void ensureTableReady().then(activate).catch(onReadError);
      else activate();
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
    const horizontal = session.kind === 'column';
    const axisDistance = Math.abs(horizontal ? event.clientX - session.startX : event.clientY - session.startY);
    if (axisDistance >= DRAG_SCROLL_INTENT_DISTANCE) session.dragIntentConfirmed = true;
    tableReorderAutoScroll.update({ x: event.clientX, y: event.clientY, axis: horizontal ? 'x' : 'y' }, Boolean(session.dragIntentConfirmed));
    event.preventDefault();
    return true;
  };

  const endTableReorder = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = tableReorderSession.current;
    if (!session || session.pointerId !== event.pointerId) return false;
    if (session.timer) window.clearTimeout(session.timer);
    tableReorderAutoScroll.stop();
    tableReorderPointer.current = undefined;
    tableReorderSession.current = undefined;
    drawerSwipe.current = undefined;
    setTableReorderVisual(undefined);
    if (!session.active) return false;
    const currentData = dataRef.current;
    if (currentData && table && reorderOwner.current === table.id && session.sourceId !== session.targetId) {
      const current = currentData.tables.find(item => item.id === table.id);
      if (current) {
        const next = { ...current, updatedAt: Date.now(), ...(session.kind === 'row'
          ? { rows: reorderBeforeOrAfter(current.rows, session.sourceId, session.targetId, session.after) }
          : { columns: reorderBeforeOrAfter(current.columns, session.sourceId, session.targetId, session.after) }) };
        const before = session.kind === 'row' ? current.rows : current.columns;
        const after = session.kind === 'row' ? next.rows : next.columns;
        if (before.some((item, index) => item !== after[index])) {
          commit(updateTable(currentData, table.id, () => next), {
            tableId: table.id, label: session.kind === 'row' ? '重新排列物件' : '重新排列屬性',
            action: { type: session.kind === 'row' ? 'reorder-rows' : 'reorder-columns', beforeIds: before.map(item => item.id), afterIds: after.map(item => item.id) },
          });
          setNotice(session.kind === 'row' ? '已調整物件順序' : '已調整屬性順序');
        }
      }
    }
    suppressNextTableClick(120);
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
    const activeHold = cellHold.current;
    if (activeHold?.active && activeHold.pointerId !== event.pointerId) {
      cellHold.current = undefined;
      pointers.current.set(activeHold.pointerId, { x: activeHold.x, y: activeHold.y });
    }
    if (pointers.current.size === 0 && event.pointerType !== 'mouse' && (onDrawerSwipeProgress || onDrawerSwipeEnd)) {
      const allowed = canInitiateDrawerSwipe(event.clientX);
      const firstColumn = (event.target as Element).closest<HTMLElement>('.workspace-row-heading');
      const startsInEmptyViewport = !(event.target as Element).closest('table');
      drawerSwipe.current = allowed && (firstColumn || startsInEmptyViewport)
        ? { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, lastDeltaX: 0 }
        : undefined;
    } else if (pointers.current.size > 0) {
      drawerSwipe.current = undefined;
    }
    if (pointers.current.size === 0 && onCellLongPress) {
      const cell = (event.target as Element).closest<HTMLTableCellElement>('td[data-bulk-row-id][data-bulk-column-id]');
      const rowId = cell?.dataset.bulkRowId;
      const columnId = cell?.dataset.bulkColumnId;
      if (rowId && columnId) {
        const startedInLane = isInCellSweepLane(cell.getBoundingClientRect(), event.clientX);
        const bulkTouch = event.pointerType === 'touch' && Boolean(bulkSelectionColumnId);
        const immediate = bulkTouch && columnId === bulkSelectionColumnId && startedInLane;
        const hold: CellHoldSession = {
          pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          x: event.clientX, y: event.clientY, cell, columnId, lastRowId: rowId,
          directionX: event.clientX, directionY: event.clientY,
          active: immediate, canSweep: immediate, startedInLane,
          immediate, blockTap: bulkTouch && !immediate,
          mode: 'pending',
        };
        if (!bulkTouch) {
          const owner = table?.id;
          hold.timer = window.setTimeout(() => {
            const activate = () => {
              if (cellHold.current !== hold || latest.current.tableId !== owner) return;
              hold.active = true;
              pointers.current.clear();
              panStart.current = undefined;
              pinchStart.current = undefined;
              setPanning(false);
              suppressNextTableClick(500, event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : undefined);
              try { viewport.setPointerCapture(event.pointerId); } catch { /* The pointer may have ended. */ }
              hold.canSweep = latest.current.onCellLongPress?.(rowId, columnId) !== false;
            };
            if (ensureTableReady) void ensureTableReady().then(activate).catch(onReadError);
            else activate();
          }, tableReorderHoldMs);
        }
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

  const resumeTablePanFromHold = (hold: CellHoldSession, viewport: HTMLDivElement, x: number, y: number, includeCurrentMove: boolean) => {
    cellHold.current = undefined;
    pointers.current.set(hold.pointerId, { x, y });
    panStart.current = {
      pointerId: hold.pointerId,
      x: includeCurrentMove ? hold.startX : x,
      y: includeCurrentMove ? hold.startY : y,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    panAxis.current = undefined;
    panMetrics.current = undefined;
    pointerMoved.current = false;
  };

  const moveTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drawerGesture = drawerSwipe.current;
    if (drawerGesture?.pointerId === event.pointerId) {
      const deltaX = event.clientX - drawerGesture.startX;
      const deltaY = event.clientY - drawerGesture.startY;
      if (drawerGesture.active) {
        drawerGesture.lastDeltaX = deltaX;
        onDrawerSwipeProgress?.(Math.max(0, deltaX));
        event.preventDefault();
        return;
      }
      if (deltaX > 8 && deltaX > Math.abs(deltaY)) {
        drawerGesture.active = true;
        drawerGesture.lastDeltaX = deltaX;
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
        suppressNextTableClick(120);
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The pointer may already have been cancelled. */ }
        onDrawerSwipeProgress?.(deltaX);
        event.preventDefault();
        return;
      }
      if (Math.hypot(deltaX, deltaY) > 10 && (deltaX <= 0 || Math.abs(deltaY) >= deltaX)) drawerSwipe.current = undefined;
    }
    const hold = cellHold.current;
    if (hold?.pointerId === event.pointerId) {
      if (!hold.active && Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) > (hold.blockTap ? 10 : 8)) {
        if (hold.timer) window.clearTimeout(hold.timer);
        cellHold.current = undefined;
      } else if (hold.active) {
        hold.x = event.clientX;
        hold.y = event.clientY;
        const inLane = hold.startedInLane && isInCellSweepLane(hold.cell.getBoundingClientRect(), event.clientX);
        const deltaX = event.clientX - hold.startX;
        const deltaY = event.clientY - hold.startY;
        if (hold.mode === 'pending') {
          const cross = Math.abs(deltaX);
          const resolved = !hold.canSweep || !inLane || cross >= CELL_SWEEP_CROSS_AXIS_DISTANCE || Math.hypot(deltaX, deltaY) >= CELL_SWEEP_INTENT_DISTANCE;
          if (!resolved) {
            event.preventDefault();
            return;
          }
          const sweepDirection = hold.canSweep && inLane && isCellSweepDirection(deltaX, deltaY);
          if (sweepDirection && (!hold.immediate || onCellLongPress?.(hold.lastRowId, hold.columnId) !== false)) {
            hold.mode = 'selecting';
            hold.directionX = event.clientX;
            hold.directionY = event.clientY;
          } else {
            resumeTablePanFromHold(hold, event.currentTarget, event.clientX, event.clientY, true);
          }
        }
        if (cellHold.current === hold && hold.mode === 'selecting') {
          if (!inLane) {
            resumeTablePanFromHold(hold, event.currentTarget, event.clientX, event.clientY, false);
            event.preventDefault();
            return;
          }
          const segmentX = event.clientX - hold.directionX;
          const segmentY = event.clientY - hold.directionY;
          const segmentCross = Math.abs(segmentX);
          if (segmentCross >= CELL_SWEEP_CROSS_AXIS_DISTANCE || Math.hypot(segmentX, segmentY) >= CELL_SWEEP_INTENT_DISTANCE) {
            if (!isCellSweepDirection(segmentX, segmentY)) {
              resumeTablePanFromHold(hold, event.currentTarget, event.clientX, event.clientY, false);
              event.preventDefault();
              return;
            }
            hold.directionX = event.clientX;
            hold.directionY = event.clientY;
          }
          const target = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLTableCellElement>('td[data-bulk-row-id][data-bulk-column-id]');
          const targetRowId = target?.dataset.bulkColumnId === hold.columnId ? target.dataset.bulkRowId : undefined;
          if (targetRowId && targetRowId !== hold.lastRowId) {
            onCellSweep?.(hold.lastRowId, targetRowId, hold.columnId);
            hold.lastRowId = targetRowId;
          }
          event.preventDefault();
          return;
        }
        // The hold became a pan; continue with the normal pan handler below.
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

        const viewportMaxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        const boundaryMaxTop = viewportMaxTop > 0 ? viewportMaxTop : maxTop;
        const boundaryEdge = bulkSelectionColumnId ? undefined : getTableBoundarySearchEdge(panStart.current.scrollTop, targetScrollTop, boundaryMaxTop, deltaY, bounceAxis);
        const pullsPastTop = bounceAxis === 'y'
          && panStart.current.scrollTop <= TABLE_BOUNDARY_SCROLL_TOLERANCE
          && targetScrollTop < 0
          && deltaY > 0;
        if (pullsPastTop && onRevealTopRow) {
          clearBoundarySearchHold();
          onRevealTopRow();
        } else if (boundaryEdge && event.pointerType !== 'mouse') armBoundarySearchHold(event.pointerId, boundaryEdge);
        else clearBoundarySearchHold();
      }

      event.preventDefault();
    }
  };

  const endTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drawerGesture = drawerSwipe.current;
    if (drawerGesture?.pointerId === event.pointerId) {
      drawerSwipe.current = undefined;
      if (drawerGesture.active) {
        onDrawerSwipeEnd?.(drawerGesture.lastDeltaX);
        event.preventDefault();
        return;
      }
    }
    const hold = cellHold.current;
    if (hold?.pointerId === event.pointerId) {
      if (hold.timer) window.clearTimeout(hold.timer);
      cellHold.current = undefined;
      if (hold.active || hold.blockTap) {
        const viewport = event.currentTarget;
        if (viewport.hasPointerCapture?.(event.pointerId)) {
          try { viewport.releasePointerCapture(event.pointerId); } catch { /* The pointer may already have ended. */ }
        }
        if (hold.immediate && hold.mode === 'pending' && event.type !== 'pointercancel'
          && Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) <= 10
          && isInCellSweepLane(hold.cell.getBoundingClientRect(), event.clientX)) {
          onCellTap?.(hold.lastRowId, hold.columnId);
        }
        pointers.current.delete(event.pointerId);
        panStart.current = undefined;
        pinchStart.current = undefined;
        panAxis.current = undefined;
        pointerMoved.current = false;
        setPanning(false);
        suppressNextTableClick(500, event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : undefined);
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
        suppressNextTableClick(event.pointerType === 'touch' ? 500 : 0, event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : undefined);
      }
      if (event.pointerType === 'touch') {
        pendingScaleSave.current = latest.current.tableId ? { tableId: latest.current.tableId, scale: textScaleRef.current } : undefined;
        flushPendingTextScale();
      }
    }
  };

  useEffect(() => () => {
    if (cellHold.current?.timer) window.clearTimeout(cellHold.current.timer);
    if (tableReorderSession.current?.timer) window.clearTimeout(tableReorderSession.current.timer);
    if (boundarySearchHold.current?.timer !== undefined) window.clearTimeout(boundarySearchHold.current.timer);
    if (ignoreNextTableClickTimer.current !== undefined) window.clearTimeout(ignoreNextTableClickTimer.current);
    momentumScroll.stop();
    cellHold.current = undefined;
    tableReorderSession.current = undefined;
  }, [momentumScroll.stop]);

  return {
    textScale, panning, tableReorderVisual, consumeSuppressedTableClick,
    setTextScale, applyTextScale,
    beginTableReorder, moveTableReorder, endTableReorder,
    beginTablePan, moveTablePan, endTablePan,
  };
}

export { canInitiateDrawerSwipe, CELL_SWEEP_DIRECTION_RATIO, CELL_SWEEP_INTENT_DISTANCE, cellSweepGuardSize, clampDrawerOffset, getDrawerCloseSwipeOffset, getDrawerOpenSwipeOffset, getTableBoundarySearchEdge, isCellSweepDirection, isInCellSweepLane, isWorkspaceStandaloneMode, shouldKeepDrawerOpen, shouldOpenDrawer, TABLE_BOUNDARY_SEARCH_HOLD_MS } from './tableGestureGeometry';
