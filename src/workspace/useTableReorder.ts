import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseTableGesturesProps } from './tableGestureTypes';
import { DRAG_SCROLL_INTENT_DISTANCE, useDragEdgeAutoScroll } from './useDragEdgeAutoScroll';
import { reorderBeforeOrAfter, tableReorderHoldMs, updateTable, type TableReorderKind, type TableReorderVisual } from './workspaceShared';

type UseTableReorderOptions = Pick<UseTableGesturesProps, 'data' | 'commit' | 'viewportRef' | 'setNotice' | 'ensureTableReady' | 'onReadError'> & {
  tableId: string | undefined;
  onActivate(): void;
  onFinish(): void;
};

interface TableReorderSession extends TableReorderVisual {
  tableId: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  dragIntentConfirmed?: boolean;
  timer?: number;
  captureTarget?: HTMLDivElement;
}

/** Owns sorting state and cancellation; other gestures keep their own pointer state. */
export function useTableReorder(options: UseTableReorderOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [tableReorderVisual, setTableReorderVisual] = useState<TableReorderVisual>();
  const sessionRef = useRef<TableReorderSession | undefined>(undefined);
  const pointerRef = useRef<{ session: TableReorderSession; x: number; y: number } | undefined>(undefined);

  const isCurrentSession = (session: TableReorderSession) => sessionRef.current === session && latest.current.tableId === session.tableId;
  const updateTarget = (session: TableReorderSession, clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(session.kind === 'row' ? '[data-row-id]' : '[data-column-id]');
    const targetId = target?.dataset[session.kind === 'row' ? 'rowId' : 'columnId'];
    if (!target || !targetId) return;
    const rect = target.getBoundingClientRect();
    session.targetId = targetId;
    session.after = session.kind === 'column' ? clientX > rect.left + rect.width / 2 : clientY > rect.top + rect.height / 2;
    setTableReorderVisual({ kind: session.kind, sourceId: session.sourceId, targetId, after: session.after });
  };
  const autoScroll = useDragEdgeAutoScroll({
    getContainer: () => options.viewportRef.current,
    onScroll: () => {
      const pointer = pointerRef.current;
      if (pointer && isCurrentSession(pointer.session)) updateTarget(pointer.session, pointer.x, pointer.y);
    },
  });

  const resetReorder = useCallback(() => {
    const session = sessionRef.current;
    if (session?.timer !== undefined) window.clearTimeout(session.timer);
    const target = session?.captureTarget;
    if (session && target?.hasPointerCapture?.(session.pointerId)) {
      try { target.releasePointerCapture(session.pointerId); } catch { /* The pointer may have ended. */ }
    }
    sessionRef.current = undefined;
    pointerRef.current = undefined;
    autoScroll.stop();
    setTableReorderVisual(undefined);
  }, [autoScroll.stop]);

  useEffect(() => {
    resetReorder();
    return resetReorder;
  }, [options.tableId, resetReorder]);

  const activate = (session: TableReorderSession) => {
    if (!isCurrentSession(session)) return;
    session.active = true;
    latest.current.onActivate();
    setTableReorderVisual({ kind: session.kind, sourceId: session.sourceId, targetId: session.targetId, after: session.after });
    const viewport = latest.current.viewportRef.current;
    if (viewport && 'setPointerCapture' in viewport) {
      try { viewport.setPointerCapture(session.pointerId); session.captureTarget = viewport; } catch { /* Pointer capture is optional. */ }
    }
  };

  const beginTableReorder = (kind: TableReorderKind, sourceId: string, event: React.PointerEvent<HTMLElement>) => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || !options.tableId) return;
    resetReorder();
    const session: TableReorderSession = { kind, sourceId, targetId: sourceId, after: false, tableId: options.tableId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
    sessionRef.current = session;
    session.timer = window.setTimeout(() => {
      session.timer = undefined;
      const ensureReady = latest.current.ensureTableReady;
      if (ensureReady) void ensureReady().then(() => activate(session)).catch(error => {
        if (!isCurrentSession(session)) return;
        resetReorder();
        latest.current.onReadError?.(error);
      });
      else activate(session);
    }, tableReorderHoldMs);
  };

  const moveTableReorder = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return false;
    if (!session.active) {
      if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) > 8) resetReorder();
      return false;
    }
    pointerRef.current = { session, x: event.clientX, y: event.clientY };
    updateTarget(session, event.clientX, event.clientY);
    const horizontal = session.kind === 'column';
    if (Math.abs(horizontal ? event.clientX - session.startX : event.clientY - session.startY) >= DRAG_SCROLL_INTENT_DISTANCE) session.dragIntentConfirmed = true;
    autoScroll.update({ x: event.clientX, y: event.clientY, axis: horizontal ? 'x' : 'y' }, Boolean(session.dragIntentConfirmed));
    event.preventDefault();
    return true;
  };

  const commitReorder = (session: TableReorderSession) => {
    const { data, tableId, commit, setNotice } = latest.current;
    if (!data || tableId !== session.tableId || session.sourceId === session.targetId) return;
    const current = data.tables.find(item => item.id === session.tableId);
    if (!current) return;
    const next = { ...current, updatedAt: Date.now(), ...(session.kind === 'row'
      ? { rows: reorderBeforeOrAfter(current.rows, session.sourceId, session.targetId, session.after) }
      : { columns: reorderBeforeOrAfter(current.columns, session.sourceId, session.targetId, session.after) }) };
    const before = session.kind === 'row' ? current.rows : current.columns;
    const after = session.kind === 'row' ? next.rows : next.columns;
    const beforeIndex = before.findIndex(item => item.id === session.sourceId);
    const afterIndex = after.findIndex(item => item.id === session.sourceId);
    if (beforeIndex < 0 || afterIndex < 0 || beforeIndex === afterIndex) return;
    commit(updateTable(data, session.tableId, () => next), {
      tableId: session.tableId, label: session.kind === 'row' ? '重新排列物件' : '重新排列屬性',
      action: session.kind === 'row'
        ? { type: 'move-row', rowId: session.sourceId, beforeIndex, afterIndex }
        : { type: 'move-column', columnId: session.sourceId, beforeIndex, afterIndex },
    });
    setNotice(session.kind === 'row' ? '已調整物件順序' : '已調整屬性順序');
  };

  const endTableReorder = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return false;
    resetReorder();
    latest.current.onFinish();
    if (!session.active) return false;
    if (event.type !== 'pointercancel') commitReorder(session);
    event.preventDefault();
    return true;
  };

  return { tableReorderVisual, beginTableReorder, moveTableReorder, endTableReorder };
}
