import { useCallback, useEffect, useRef, useState } from 'react';
import { canInitiateDrawerSwipe, CELL_SWEEP_CROSS_AXIS_DISTANCE, CELL_SWEEP_INTENT_DISTANCE, getTableBoundarySearchEdge, isCellSweepDirection, isInCellSweepLane, TABLE_BOUNDARY_SCROLL_TOLERANCE, TABLE_BOUNDARY_SEARCH_HOLD_MS } from './tableGestureGeometry';
import type { CellHoldSession, TableHeaderTapSession, TableHeaderTapTarget, UseTableGesturesProps } from './tableGestureTypes';
import { applyTableBounce, getTableContentScrollBounds, getTablePanAxis, resetTableBounce, settleTableBounce, TABLE_BOUNCE_LIMIT, TABLE_BOUNCE_RESISTANCE, TablePanAxis, useMomentumScroll } from './useMomentumScroll';
import { useTableZoom } from './useTableZoom';
import { useTableReorder } from './useTableReorder';
import { tableReorderHoldMs } from './workspaceShared';
export function useTableGestures({ table, data, commit, viewportRef, workspacePageRef, setNotice, minTextScale, onCellLongPress, onCellSweep, onCellTap, onHeaderTap, bulkSelectionColumnId, onDrawerSwipeProgress, onDrawerSwipeEnd, onOpenSearch, onRevealTopRow, searchOpen = false, ensureTableReady, onReadError, onPersistTextScale }: UseTableGesturesProps) {
  const [panning, setPanning] = useState(false);
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
  const momentumStopPointer = useRef<number | undefined>(undefined);
  const ignoreNextTableClick = useRef(false);
  const ignoredTouchClickAt = useRef<{ x: number; y: number } | undefined>(undefined);
  const ignoreNextTableClickTimer = useRef<number | undefined>(undefined);
  const handledTouchClickCleanup = useRef<(() => void) | undefined>(undefined);
  const cellHold = useRef<CellHoldSession | undefined>(undefined);
  const headerTap = useRef<TableHeaderTapSession | undefined>(undefined);
  const drawerSwipe = useRef<{ pointerId: number; startX: number; startY: number; active: boolean; lastDeltaX: number } | undefined>(undefined);
  const boundarySearchHold = useRef<{ pointerId: number; edge: 'top' | 'bottom'; timer?: number; triggered: boolean } | undefined>(undefined);
  
  const momentumScroll = useMomentumScroll();
  const clearSuppressedTableClick = useCallback(() => {
    if (ignoreNextTableClickTimer.current !== undefined) window.clearTimeout(ignoreNextTableClickTimer.current);
    handledTouchClickCleanup.current?.();
    handledTouchClickCleanup.current = undefined;
    ignoreNextTableClick.current = false;
    ignoredTouchClickAt.current = undefined;
    ignoreNextTableClickTimer.current = undefined;
  }, []);
  useEffect(() => {
    if (cellHold.current?.timer) window.clearTimeout(cellHold.current.timer);
    if (boundarySearchHold.current?.timer !== undefined) window.clearTimeout(boundarySearchHold.current.timer);
    cellHold.current = undefined; headerTap.current = undefined; boundarySearchHold.current = undefined;
    pointers.current.clear(); panStart.current = undefined; pinchStart.current = undefined; drawerSwipe.current = undefined;
    momentumStopPointer.current = undefined;
    panMetrics.current = undefined; panAxis.current = undefined;
    clearSuppressedTableClick();
    momentumScroll.stop(); setPanning(false);
  }, [table?.id, momentumScroll.stop, clearSuppressedTableClick]);

  const clearBoundarySearchHold = () => {
    if (boundarySearchHold.current?.timer !== undefined) window.clearTimeout(boundarySearchHold.current.timer);
    boundarySearchHold.current = undefined;
  };

  const suppressNextTableClick = (duration: number, touchPoint?: { x: number; y: number }) => {
    clearSuppressedTableClick();
    ignoreNextTableClick.current = true;
    ignoredTouchClickAt.current = touchPoint;
    ignoreNextTableClickTimer.current = window.setTimeout(clearSuppressedTableClick, duration);
  };

  const suppressHandledTouchClick = (x: number, y: number) => {
    suppressNextTableClick(500, { x, y });
    // Opening the editor on pointerup can retarget the compatibility click to
    // its backdrop. Catch only this tap's click, even outside the viewport.
    const consumeClick = (click: MouseEvent) => {
      const pointerType = (click as MouseEvent & { pointerType?: string }).pointerType;
      if (click.detail === 0 || (pointerType && pointerType !== 'touch')
        || Math.hypot(click.clientX - x, click.clientY - y) > 12) return;
      click.preventDefault();
      click.stopImmediatePropagation();
      clearSuppressedTableClick();
    };
    document.addEventListener('click', consumeClick, true);
    document.addEventListener('pointerdown', clearSuppressedTableClick, true);
    handledTouchClickCleanup.current = () => {
      document.removeEventListener('click', consumeClick, true);
      document.removeEventListener('pointerdown', clearSuppressedTableClick, true);
    };
  };

  const consumeSuppressedTableClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!ignoreNextTableClick.current) return false;
    const touchPoint = ignoredTouchClickAt.current;
    if (touchPoint) {
      const click = event.nativeEvent as MouseEvent & { pointerType?: string; sourceCapabilities?: { firesTouchEvents?: boolean } };
      const fromTouch = click.pointerType === 'touch' || click.sourceCapabilities?.firesTouchEvents;
      if (!fromTouch && (click.pointerType === 'mouse' || Math.hypot(click.clientX - touchPoint.x, click.clientY - touchPoint.y) > 12)) return false;
    }
    clearSuppressedTableClick();
    return true;
  }, [clearSuppressedTableClick]);

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

  const { tableReorderVisual, beginTableReorder, moveTableReorder, endTableReorder: finishTableReorder } = useTableReorder({
    tableId: table?.id, data, commit, viewportRef, setNotice, ensureTableReady, onReadError,
    onActivate: () => {
      headerTap.current = undefined;
      pointers.current.clear(); panStart.current = undefined; pinchStart.current = undefined;
      setPanning(false);
    },
    onFinish: () => { drawerSwipe.current = undefined; },
  });
  const endTableReorder = (event: React.PointerEvent<HTMLDivElement>) => {
    const handled = finishTableReorder(event);
    if (handled) suppressNextTableClick(120);
    return handled;
  };

  const beginTablePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const interruptedMomentum = event.pointerType === 'touch' && momentumScroll.isCoasting();
    momentumScroll.stop();
    clearBoundarySearchHold();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest('input, textarea')) return;
    // A new pointer gesture must not inherit the previous release's click guard.
    clearSuppressedTableClick();
    if (pointers.current.size === 0) momentumStopPointer.current = interruptedMomentum ? event.pointerId : undefined;
    headerTap.current = undefined;
    if (pointers.current.size === 0 && event.pointerType === 'touch' && !interruptedMomentum && onHeaderTap
      && !(event.target as Element).closest('a, input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
      const cell = (event.target as Element).closest<HTMLTableCellElement>('th');
      const rowId = cell?.dataset.rowId, columnId = cell?.dataset.columnId;
      const target: TableHeaderTapTarget | undefined = rowId ? { kind: 'row', id: rowId }
        : columnId ? { kind: 'column', id: columnId }
        : cell?.classList.contains('workspace-row-corner') ? { kind: 'corner' } : undefined;
      if (cell && target) headerTap.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cell, target };
    }
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
    if (pointers.current.size === 0 && (onCellLongPress || onCellTap)) {
      const cell = (event.target as Element).closest<HTMLTableCellElement>('td[data-bulk-row-id][data-bulk-column-id]');
      const rowId = cell?.dataset.bulkRowId;
      const columnId = cell?.dataset.bulkColumnId;
      if (rowId && columnId) {
        const startedInLane = isInCellSweepLane(cell.getBoundingClientRect(), event.clientX);
        const bulkTouch = event.pointerType === 'touch' && Boolean(bulkSelectionColumnId);
        const immediate = !interruptedMomentum && bulkTouch && columnId === bulkSelectionColumnId && startedInLane;
        const hold: CellHoldSession = {
          pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          x: event.clientX, y: event.clientY, cell, columnId, lastRowId: rowId,
          directionX: event.clientX, directionY: event.clientY,
          active: immediate, canSweep: immediate, startedInLane,
          immediate, blockTap: bulkTouch && !immediate,
          canTap: !interruptedMomentum && event.pointerType === 'touch' && Boolean(onCellTap)
            && !(event.target as Element).closest('a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
          mode: 'pending',
        };
        if (!interruptedMomentum && !bulkTouch && onCellLongPress) {
          const owner = table?.id;
          hold.timer = window.setTimeout(() => {
            hold.canTap = false;
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
    } else if (cellHold.current) {
      if (cellHold.current.timer) window.clearTimeout(cellHold.current.timer);
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
          if (targetScrollLeft < 0) overX = Math.min(TABLE_BOUNCE_LIMIT, -targetScrollLeft * TABLE_BOUNCE_RESISTANCE);
          else if (targetScrollLeft > maxLeft) overX = Math.max(-TABLE_BOUNCE_LIMIT, (maxLeft - targetScrollLeft) * TABLE_BOUNCE_RESISTANCE);
        } else if (bounceAxis === 'y') {
          if (targetScrollTop < 0) overY = Math.min(TABLE_BOUNCE_LIMIT, -targetScrollTop * TABLE_BOUNCE_RESISTANCE);
          else if (targetScrollTop > maxTop) overY = Math.max(-TABLE_BOUNCE_LIMIT, (maxTop - targetScrollTop) * TABLE_BOUNCE_RESISTANCE);
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
    const stoppedMomentum = momentumStopPointer.current === event.pointerId;
    if (stoppedMomentum) momentumStopPointer.current = undefined;
    const header = headerTap.current?.pointerId === event.pointerId ? headerTap.current : undefined;
    if (header) headerTap.current = undefined;
    const validHeaderTap = header && !pointerMoved.current && pointers.current.size === 1
      && event.type === 'pointerup' && header.cell.isConnected
      && Math.hypot(event.clientX - header.startX, event.clientY - header.startY) <= 10 ? header : undefined;
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
    const tap = hold?.pointerId === event.pointerId && hold.canTap && !hold.active && !hold.blockTap
      && !pointerMoved.current && pointers.current.size === 1 && event.type === 'pointerup'
      && hold.cell.isConnected && Math.hypot(event.clientX - hold.startX, event.clientY - hold.startY) <= 10
      ? hold : undefined;
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
      } else if (stoppedMomentum && event.type === 'pointerup') {
        // This gesture stopped a fling; consume its compatibility click too.
        suppressHandledTouchClick(event.clientX, event.clientY);
      } else if (validHeaderTap && onHeaderTap) {
        suppressHandledTouchClick(event.clientX, event.clientY);
        onHeaderTap(validHeaderTap.target);
      } else if (tap && onCellTap) {
        // A validated touch tap must not depend on the browser emitting a click
        // after an edge fling. Consume that click if it does arrive afterwards.
        suppressHandledTouchClick(event.clientX, event.clientY);
        onCellTap(tap.lastRowId, tap.columnId);
      }
      if (event.pointerType === 'touch') {
        pendingScaleSave.current = latest.current.tableId ? { tableId: latest.current.tableId, scale: textScaleRef.current } : undefined;
        flushPendingTextScale();
      }
    }
  };

  useEffect(() => () => {
    if (cellHold.current?.timer) window.clearTimeout(cellHold.current.timer);
    if (boundarySearchHold.current?.timer !== undefined) window.clearTimeout(boundarySearchHold.current.timer);
    clearSuppressedTableClick();
    momentumScroll.stop();
    momentumStopPointer.current = undefined;
    cellHold.current = undefined;
    headerTap.current = undefined;
  }, [momentumScroll.stop, clearSuppressedTableClick]);

  return {
    textScale, panning, tableReorderVisual, consumeSuppressedTableClick,
    setTextScale, applyTextScale,
    beginTableReorder, moveTableReorder, endTableReorder,
    beginTablePan, moveTablePan, endTablePan,
  };
}

export { canInitiateDrawerSwipe, CELL_SWEEP_DIRECTION_RATIO, CELL_SWEEP_INTENT_DISTANCE, cellSweepGuardSize, clampDrawerOffset, getDrawerCloseSwipeOffset, getDrawerOpenSwipeOffset, getTableBoundarySearchEdge, isCellSweepDirection, isInCellSweepLane, isWorkspaceStandaloneMode, shouldKeepDrawerOpen, shouldOpenDrawer, TABLE_BOUNDARY_SEARCH_HOLD_MS } from './tableGestureGeometry';
