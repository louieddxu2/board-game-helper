import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { useMomentumScroll } from '../workspace/useMomentumScroll';

type RankingGesture = {
  pointerId: number;
  button: HTMLButtonElement | null;
  id?: string;
  horizontal: boolean;
  touch: boolean;
  startX: number;
  startY: number;
  startedAt: number;
  x: number;
  y: number;
  dragging: boolean;
  panning: boolean;
  poolScrollStart?: number;
};

export const useAttributeRankingInput = (listRef: RefObject<HTMLDivElement | null>, poolRef: RefObject<HTMLDivElement | null>, onPlace: (id: string, index: number) => void) => {
  const gesture = useRef<RankingGesture | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const ignoreClick = useRef(false);
  const [drag, setDrag] = useState<{ id: string; index: number | null } | null>(null);
  const { stop, trackMove, release } = useMomentumScroll();

  useEffect(() => () => { cancelAnimationFrame(frame.current); stop(); }, [stop]);

  const dropIndex = (x: number, y: number) => {
    const list = listRef.current;
    if (!list) return null;
    const area = list.getBoundingClientRect();
    if (x < area.left || x >= area.right || y < area.top || y >= area.bottom) return null;
    const rows = Array.from(list.querySelectorAll('[data-rank-row]'));
    const index = rows.findIndex((row) => {
      const bounds = row.getBoundingClientRect();
      return y < bounds.top + bounds.height / 2;
    });
    return index < 0 ? rows.length : index;
  };

  const updateTarget = (id: string, x: number, y: number) => {
    const index = dropIndex(x, y);
    setDrag((current) => current?.id === id && current.index === index ? current : { id, index });
  };

  const scrollAtEdge = () => {
    const active = gesture.current;
    const list = listRef.current;
    if (!active?.dragging || active.id == null || !list) return;
    const area = list.getBoundingClientRect();
    if (active.x >= area.left && active.x < area.right && active.y >= area.top && active.y < area.bottom) {
      const topDistance = active.y - area.top;
      const bottomDistance = area.bottom - active.y;
      const delta = topDistance < 30 ? topDistance - 30 : Math.max(0, 30 - bottomDistance);
      if (delta) {
        list.scrollTop += delta / 3;
        updateTarget(active.id, active.x, active.y);
      }
    }
    frame.current = requestAnimationFrame(scrollAtEdge);
  };

  const finish = (area: HTMLElement) => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.touch) ignoreClick.current = true;
    if (active && area.hasPointerCapture(active.pointerId)) area.releasePointerCapture(active.pointerId);
    cancelAnimationFrame(frame.current);
    if (active?.dragging) setDrag(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    // A fresh touch takes ownership even while the candidate column is coasting.
    stop();
    if (!event.isPrimary) {
      finish(event.currentTarget);
      return;
    }
    ignoreClick.current = false;
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('button:enabled');
    const touch = event.pointerType === 'touch';
    const pool = touch && poolRef.current?.contains(target) ? poolRef.current : null;
    if ((!button && !pool) || event.button !== 0) return;
    const horizontal = button?.dataset.rankSource === 'pool';
    const id = !touch || horizontal || target.closest('[data-rank-grip]') ? button?.dataset.rankGame : undefined;
    if (!touch && id == null) return;
    if (pool) trackMove(event.clientX, event.clientY);
    gesture.current = {
      button, id, horizontal, touch, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, startedAt: event.timeStamp,
      x: event.clientX, y: event.clientY, dragging: false, panning: false, poolScrollStart: pool?.scrollTop,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    const { clientX: x, clientY: y } = event;
    const dx = x - active.startX;
    const dy = y - active.startY;
    const distance = Math.hypot(dx, dy);
    if (!active.dragging && !active.panning) {
      if (distance < 9) return;
      const verticalScroll = active.poolScrollStart !== undefined && Math.abs(dy) >= Math.abs(dx);
      if (verticalScroll) {
        active.panning = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      } else if (active.id == null || (active.touch && event.timeStamp - active.startedAt > 500)) {
        finish(event.currentTarget);
        return;
      } else {
        if (active.touch && active.horizontal && dx < 9) return;
        active.dragging = true;
        ignoreClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        frame.current = requestAnimationFrame(scrollAtEdge);
      }
    }
    if (active.panning && poolRef.current && active.poolScrollStart !== undefined) {
      poolRef.current.scrollTop = active.poolScrollStart - dy;
      trackMove(x, y);
      return;
    }
    active.x = x;
    active.y = y;
    const ghost = ghostRef.current;
    if (ghost) {
      const bounds = event.currentTarget.getBoundingClientRect();
      ghost.style.left = `${Math.max(0, Math.min(x - bounds.left, bounds.width - 162))}px`;
      ghost.style.top = `${Math.max(30, y - bounds.top)}px`;
    }
    if (active.id != null) updateTarget(active.id, x, y);
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const active = gesture.current;
    if (active?.pointerId !== event.pointerId) return;
    const { clientX: x, clientY: y } = event;
    const index = active.dragging ? dropIndex(x, y) : null;
    finish(event.currentTarget);
    if (active.panning) {
      if (poolRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) release(poolRef.current, 'y');
      return;
    }
    if (active.id != null && index != null) {
      onPlace(active.id, index);
      return;
    }
    if (!active.dragging && active.touch && active.button && Math.hypot(x - active.startX, y - active.startY) < 9
      && event.timeStamp - active.startedAt <= 500 && document.elementFromPoint(x, y)?.closest('button') === active.button) {
      // A native touch release can arrive without a compatibility click after a drag.
      active.button.click();
    }
  };

  return {
    drag, ghostRef,
    input: {
      onPointerDown, onPointerMove, onPointerUp,
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event.currentTarget),
      onPointerLeave: (event: PointerEvent<HTMLElement>) => {
        if (!gesture.current?.dragging && !gesture.current?.panning) finish(event.currentTarget);
      },
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
        if (event.target === event.currentTarget) finish(event.currentTarget);
      },
      onContextMenu: (event: MouseEvent<HTMLElement>) => finish(event.currentTarget),
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (!ignoreClick.current || event.detail === 0) return;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
};
