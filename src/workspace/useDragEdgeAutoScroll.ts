import { useCallback, useEffect, useRef } from 'react';

export const DRAG_SCROLL_INTENT_DISTANCE = 14;
export const DRAG_SCROLL_EDGE_SIZE = 36;
export const DRAG_SCROLL_DWELL_MS = 300;
const DRAG_SCROLL_EXIT_HYSTERESIS = 16;
const DRAG_SCROLL_START_SPEED = 2;
const DRAG_SCROLL_MAX_SPEED = 10;
const DRAG_SCROLL_RAMP_MS = 700;

type DragScrollAxis = 'x' | 'y';
type DragScrollEdge = 'left' | 'right' | 'top' | 'bottom';

interface DragScrollPointer { x: number; y: number; axis: DragScrollAxis; }
interface DragScrollState extends DragScrollPointer { edge: DragScrollEdge; active: boolean; startedAt: number; timer?: number; }
interface DragEdgeAutoScrollOptions { getContainer(): HTMLElement | null; onScroll?(): void; }

const canScrollToward = (container: HTMLElement, edge: DragScrollEdge) => {
  if (edge === 'left') return container.scrollLeft > 0;
  if (edge === 'right') return container.scrollLeft < container.scrollWidth - container.clientWidth;
  if (edge === 'top') return container.scrollTop > 0;
  return container.scrollTop < container.scrollHeight - container.clientHeight;
};

const edgeAt = (container: HTMLElement, pointer: DragScrollPointer, activeEdge?: DragScrollEdge): DragScrollEdge | undefined => {
  const rect = container.getBoundingClientRect();
  const zoneFor = (edge: DragScrollEdge) => DRAG_SCROLL_EDGE_SIZE + (activeEdge === edge ? DRAG_SCROLL_EXIT_HYSTERESIS : 0);
  if (pointer.axis === 'x') {
    if (pointer.x <= rect.left + zoneFor('left') && canScrollToward(container, 'left')) return 'left';
    if (pointer.x >= rect.right - zoneFor('right') && canScrollToward(container, 'right')) return 'right';
    return undefined;
  }
  if (pointer.y <= rect.top + zoneFor('top') && canScrollToward(container, 'top')) return 'top';
  if (pointer.y >= rect.bottom - zoneFor('bottom') && canScrollToward(container, 'bottom')) return 'bottom';
  return undefined;
};

const setEdgeVisual = (container: HTMLElement | null, state?: Pick<DragScrollState, 'edge' | 'active'>) => {
  if (!container) return;
  if (!state) {
    delete container.dataset.dragScrollEdge;
    delete container.dataset.dragScrollActive;
    return;
  }
  container.dataset.dragScrollEdge = state.edge;
  container.dataset.dragScrollActive = String(state.active);
};

export const useDragEdgeAutoScroll = ({ getContainer, onScroll }: DragEdgeAutoScrollOptions) => {
  const stateRef = useRef<DragScrollState | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const visualContainerRef = useRef<HTMLElement | null>(null);
  const getContainerRef = useRef(getContainer);
  const onScrollRef = useRef(onScroll);
  getContainerRef.current = getContainer;
  onScrollRef.current = onScroll;

  const clearFrame = useCallback(() => {
    if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
  }, []);

  const clearState = useCallback(() => {
    const state = stateRef.current;
    if (state?.timer !== undefined) window.clearTimeout(state.timer);
    clearFrame();
    stateRef.current = undefined;
    setEdgeVisual(visualContainerRef.current);
    visualContainerRef.current = null;
  }, [clearFrame]);

  const runFrameRef = useRef<() => void>(() => undefined);
  runFrameRef.current = () => {
    frameRef.current = undefined;
    const state = stateRef.current;
    const container = getContainerRef.current();
    if (!state?.active || !container || edgeAt(container, state, state.edge) !== state.edge) {
      clearState();
      return;
    }
    const progress = Math.min(1, Math.max(0, (Date.now() - state.startedAt) / DRAG_SCROLL_RAMP_MS));
    const speed = DRAG_SCROLL_START_SPEED + (DRAG_SCROLL_MAX_SPEED - DRAG_SCROLL_START_SPEED) * progress;
    const previousLeft = container.scrollLeft;
    const previousTop = container.scrollTop;
    if (state.edge === 'left') container.scrollLeft -= speed;
    else if (state.edge === 'right') container.scrollLeft += speed;
    else if (state.edge === 'top') container.scrollTop -= speed;
    else container.scrollTop += speed;
    if (container.scrollLeft === previousLeft && container.scrollTop === previousTop) {
      clearState();
      return;
    }
    onScrollRef.current?.();
    frameRef.current = window.requestAnimationFrame(runFrameRef.current);
  };

  const update = useCallback((pointer: DragScrollPointer, enabled: boolean) => {
    const container = getContainerRef.current();
    if (!enabled || !container) {
      clearState();
      return;
    }
    const current = stateRef.current;
    const edge = edgeAt(container, pointer, current?.active ? current.edge : undefined);
    if (!edge) {
      clearState();
      return;
    }
    if (current?.edge === edge && current.axis === pointer.axis) {
      current.x = pointer.x;
      current.y = pointer.y;
      return;
    }
    clearState();
    const state: DragScrollState = { ...pointer, edge, active: false, startedAt: 0 };
    stateRef.current = state;
    visualContainerRef.current = container;
    setEdgeVisual(container, state);
    state.timer = window.setTimeout(() => {
      if (stateRef.current !== state) return;
      state.active = true;
      state.startedAt = Date.now();
      setEdgeVisual(container, state);
      frameRef.current = window.requestAnimationFrame(runFrameRef.current);
    }, DRAG_SCROLL_DWELL_MS);
  }, [clearState]);

  useEffect(() => clearState, [clearState]);
  return { update, stop: clearState };
};
