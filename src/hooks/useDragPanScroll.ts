import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getTableContentScrollBounds, getTablePanAxis, type TablePanAxis, useMomentumScroll } from '../workspace/useMomentumScroll';

interface PanStart {
  pointerId: number;
  x: number;
  y: number;
  scrollLeft: number;
  scrollTop: number;
}

export const useDragPanScroll = () => {
  const [panning, setPanning] = useState(false);
  const start = useRef<PanStart | undefined>(undefined);
  const axis = useRef<TablePanAxis | undefined>(undefined);
  const moved = useRef(false);
  const suppressClick = useRef(false);
  const momentum = useMomentumScroll();

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    momentum.stop();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as Element).closest('input, textarea, select')) return;
    start.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    };
    axis.current = undefined;
    moved.current = false;
    momentum.trackMove(event.clientX, event.clientY);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - origin.x;
    const deltaY = event.clientY - origin.y;
    const threshold = event.pointerType === 'touch' ? 10 : 4;
    if (!moved.current && Math.hypot(deltaX, deltaY) <= threshold) return;
    if (!moved.current) {
      moved.current = true;
      axis.current = getTablePanAxis(deltaX, deltaY);
      setPanning(true);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
    }
    momentum.trackMove(event.clientX, event.clientY);
    event.currentTarget.scrollLeft = axis.current === 'y' ? origin.scrollLeft : origin.scrollLeft - deltaX;
    event.currentTarget.scrollTop = axis.current === 'x' ? origin.scrollTop : origin.scrollTop - deltaY;
    event.preventDefault();
  };

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    const viewport = event.currentTarget;
    const didMove = moved.current;
    if (viewport.hasPointerCapture?.(event.pointerId)) {
      try { viewport.releasePointerCapture(event.pointerId); } catch { /* The pointer may already have been cancelled. */ }
    }
    start.current = undefined;
    setPanning(false);
    if (didMove) {
      const table = viewport.querySelector('table');
      momentum.release(viewport, axis.current, getTableContentScrollBounds(viewport, table));
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      event.preventDefault();
    }
    axis.current = undefined;
    moved.current = false;
  };

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = false;
  };

  useEffect(() => () => momentum.stop(), [momentum.stop]);

  return { panning, onPointerDown, onPointerMove, onPointerUp: finishPan, onPointerCancel: finishPan, onClickCapture };
};
