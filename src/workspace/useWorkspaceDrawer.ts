import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { clampDrawerOffset, getDrawerCloseSwipeOffset, getDrawerOpenSwipeOffset, shouldKeepDrawerOpen, shouldOpenDrawer } from './useTableGestures';

export const workspaceDrawerWidth = () => Math.min(360, window.innerWidth * 0.88);

interface WorkspaceDrawerOptions {
  allTablesReadyRef: RefObject<boolean>;
  progressiveRef: RefObject<boolean>;
  pendingOpenNodeIdRef: RefObject<string | undefined>;
}

/** Drawer movement and click suppression are independent of table rendering. */
export const useWorkspaceDrawer = ({ allTablesReadyRef, progressiveRef, pendingOpenNodeIdRef }: WorkspaceDrawerOptions) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOffset, setDrawerOffset] = useState(0);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState('');
  const drawerElementRef = useRef<HTMLElement>(null);
  const drawerCloseTimerRef = useRef<number | undefined>(undefined);
  const drawerClickResetTimerRef = useRef<number | undefined>(undefined);
  const suppressNextDrawerClickRef = useRef(false);
  const drawerSwipeClickTargetRef = useRef<Element | null>(null);
  const drawerItemDraggingRef = useRef(false);
  const drawerSwipeRef = useRef<{ pointerId: number; startX: number; startY: number; active: boolean; offset: number } | undefined>(undefined);

  const openDrawer = useCallback(() => {
    if (drawerCloseTimerRef.current !== undefined) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = undefined;
    if (drawerClickResetTimerRef.current !== undefined) window.clearTimeout(drawerClickResetTimerRef.current);
    drawerClickResetTimerRef.current = undefined;
    suppressNextDrawerClickRef.current = false;
    drawerSwipeClickTargetRef.current = null;
    setDrawerOpen(true);
    setDrawerDragging(false);
    setDrawerOffset(workspaceDrawerWidth());
  }, []);
  const closeDrawer = useCallback(() => {
    pendingOpenNodeIdRef.current = undefined;
    setDrawerDragging(false);
    setDrawerOffset(0);
    if (drawerCloseTimerRef.current !== undefined) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = window.setTimeout(() => {
      setDrawerOpen(false);
      drawerCloseTimerRef.current = undefined;
    }, 180);
  }, []);
  const updateDrawerFromOpenSwipe = useCallback((deltaX: number) => {
    if (!allTablesReadyRef.current && !progressiveRef.current) return;
    if (drawerCloseTimerRef.current !== undefined) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = undefined;
    if (drawerClickResetTimerRef.current !== undefined) window.clearTimeout(drawerClickResetTimerRef.current);
    drawerClickResetTimerRef.current = undefined;
    suppressNextDrawerClickRef.current = false;
    drawerSwipeClickTargetRef.current = null;
    const width = workspaceDrawerWidth();
    setDrawerOpen(true);
    setDrawerDragging(true);
    setDrawerOffset(getDrawerOpenSwipeOffset(deltaX, width));
  }, []);
  const settleDrawerFromOpenSwipe = useCallback((deltaX: number) => {
    if (!allTablesReadyRef.current && !progressiveRef.current) return;
    const width = workspaceDrawerWidth();
    const offset = getDrawerOpenSwipeOffset(deltaX, width);
    setDrawerDragging(false);
    if (shouldOpenDrawer(offset, width)) {
      if (drawerClickResetTimerRef.current !== undefined) window.clearTimeout(drawerClickResetTimerRef.current);
      drawerClickResetTimerRef.current = undefined;
      suppressNextDrawerClickRef.current = false;
      drawerSwipeClickTargetRef.current = null;
      setDrawerOpen(true);
      setDrawerOffset(width);
    } else {
      closeDrawer();
    }
  }, [closeDrawer]);
  const beginDrawerSwipe = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (drawerItemDraggingRef.current) return;
    drawerSwipeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, offset: drawerOffset };
  }, [drawerOffset]);
  const moveDrawerSwipe = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (drawerItemDraggingRef.current) {
      drawerSwipeRef.current = undefined;
      return;
    }
    const gesture = drawerSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.active) {
      if (Math.hypot(deltaX, deltaY) <= 8) return;
      if (deltaX >= -8 || Math.abs(deltaY) >= Math.abs(deltaX)) {
        drawerSwipeRef.current = undefined;
        return;
      }
      gesture.active = true;
      suppressNextDrawerClickRef.current = true;
      drawerSwipeClickTargetRef.current = event.target instanceof Element ? event.target : null;
      setDrawerDragging(true);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The pointer may already have been cancelled. */ }
    }
    gesture.offset = getDrawerCloseSwipeOffset(deltaX, workspaceDrawerWidth());
    setDrawerOffset(gesture.offset);
    event.preventDefault();
  }, []);
  const endDrawerSwipe = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = drawerSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    drawerSwipeRef.current = undefined;
    if (!gesture.active) return;
    const width = workspaceDrawerWidth();
    const offset = clampDrawerOffset(gesture.offset, width);
    setDrawerDragging(false);
    if (shouldKeepDrawerOpen(offset, width)) setDrawerOffset(width);
    else closeDrawer();
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* The pointer may already have been released. */ }
    event.preventDefault();
    if (drawerClickResetTimerRef.current !== undefined) window.clearTimeout(drawerClickResetTimerRef.current);
    drawerClickResetTimerRef.current = window.setTimeout(() => {
      suppressNextDrawerClickRef.current = false;
      drawerSwipeClickTargetRef.current = null;
      drawerClickResetTimerRef.current = undefined;
    }, 0);
  }, [closeDrawer]);
  const suppressDrawerSwipeClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!suppressNextDrawerClickRef.current) return;
    const swipeTarget = drawerSwipeClickTargetRef.current;
    if (!swipeTarget || !(event.target instanceof Node) || !swipeTarget.contains(event.target)) return;
    suppressNextDrawerClickRef.current = false;
    drawerSwipeClickTargetRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const handleDrawerItemDragStateChange = useCallback((active: boolean) => {
    drawerItemDraggingRef.current = active;
    if (!active) return;
    drawerSwipeRef.current = undefined;
    suppressNextDrawerClickRef.current = false;
    drawerSwipeClickTargetRef.current = null;
    setDrawerDragging(false);
    setDrawerOffset(workspaceDrawerWidth());
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      setDrawerOffset(0);
      setDrawerDragging(false);
    }
  }, [drawerOpen]);
  useEffect(() => () => {
    if (drawerCloseTimerRef.current !== undefined) window.clearTimeout(drawerCloseTimerRef.current);
    if (drawerClickResetTimerRef.current !== undefined) window.clearTimeout(drawerClickResetTimerRef.current);
    drawerSwipeClickTargetRef.current = null;
  }, []);

  return {
    drawerOpen, setDrawerOpen, drawerOffset, drawerDragging, drawerQuery, setDrawerQuery, drawerElementRef,
    openDrawer, closeDrawer, updateDrawerFromOpenSwipe, settleDrawerFromOpenSwipe,
    beginDrawerSwipe, moveDrawerSwipe, endDrawerSwipe, suppressDrawerSwipeClick, handleDrawerItemDragStateChange,
  };
};
