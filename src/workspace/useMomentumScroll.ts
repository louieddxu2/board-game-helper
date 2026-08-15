import { useCallback, useRef } from 'react';

export const MAX_TABLE_MOMENTUM_VELOCITY = 100; // Max speed cap for consecutive swipe acceleration
const MAX_VELOCITY = MAX_TABLE_MOMENTUM_VELOCITY;
const ACCELERATION_STACK_FACTOR = 0.65; // Stack residual speed from previous swipe
const MAX_OVERSCROLL = 32; // Safe visual rubber-band offset limit (px)
const FRAME_INTERVAL_MS = 1000 / 60;
const MAX_FRAME_DELTA_MS = 48;
const MOMENTUM_DECAY_PER_FRAME = 0.978; // Keep a phone fling moving long enough for dense tables

export type TableBounceAxis = 'x' | 'y';
export type TablePanAxis = TableBounceAxis | 'both';

export const clampTableMomentumVelocity = (velocity: number) => Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocity));

const DIAGONAL_SLOPE_MIN = 0.72;
const DIAGONAL_SLOPE_MAX = 1 / DIAGONAL_SLOPE_MIN;

export const getTablePanAxis = (deltaX: number, deltaY: number): TablePanAxis => {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX === 0) return 'y';
  if (absY === 0) return 'x';
  const slope = absY / absX;
  if (slope >= DIAGONAL_SLOPE_MIN && slope <= DIAGONAL_SLOPE_MAX) return 'both';
  return absX > absY ? 'x' : 'y';
};

export const getTableContentScrollBounds = (viewport: HTMLDivElement, table: HTMLTableElement | null) => {
  const corner = table?.querySelector<HTMLElement>('.workspace-row-corner');
  const cornerRect = corner?.getBoundingClientRect();
  const tableRect = table?.getBoundingClientRect();
  const fixedColumnWidth = cornerRect?.width ?? 0;
  const fixedHeaderHeight = cornerRect?.height ?? 0;
  const tableWidth = Math.max(tableRect?.width ?? 0, viewport.scrollWidth);
  const tableHeight = Math.max(tableRect?.height ?? 0, viewport.scrollHeight);
  const contentWidth = Math.max(0, tableWidth - fixedColumnWidth);
  const contentHeight = Math.max(0, tableHeight - fixedHeaderHeight);
  const visibleContentWidth = Math.max(0, viewport.clientWidth - fixedColumnWidth);
  const visibleContentHeight = Math.max(0, viewport.clientHeight - fixedHeaderHeight);
  return {
    maxLeft: Math.max(0, contentWidth - visibleContentWidth),
    maxTop: Math.max(0, contentHeight - visibleContentHeight),
  };
};

export const applyTableBounce = (table: HTMLTableElement | null, x: number, y: number) => {
  if (!table) return;
  table.style.setProperty('--workspace-bounce-x', `${x.toFixed(1)}px`);
  table.style.setProperty('--workspace-bounce-y', `${y.toFixed(1)}px`);
  table.classList.toggle('is-bouncing', Math.abs(x) > 0.5 || Math.abs(y) > 0.5);
  table.classList.toggle('is-bounce-x', Math.abs(x) > 0.5);
  table.classList.toggle('is-bounce-y', Math.abs(y) > 0.5);
  table.classList.remove('is-bounce-settling');
  if (table.style.transform) table.style.transform = '';
};

export const resetTableBounce = (table: HTMLTableElement | null) => {
  if (!table) return;
  table.style.removeProperty('--workspace-bounce-x');
  table.style.removeProperty('--workspace-bounce-y');
  table.classList.remove('is-bouncing');
  table.classList.remove('is-bounce-x', 'is-bounce-y');
  table.classList.remove('is-bounce-settling');
  table.style.transform = '';
};

export const settleTableBounce = (table: HTMLTableElement | null) => {
  if (!table) return;
  table.classList.add('is-bouncing', 'is-bounce-settling');
  table.style.setProperty('--workspace-bounce-x', '0px');
  table.style.setProperty('--workspace-bounce-y', '0px');
  window.setTimeout(() => resetTableBounce(table), 200);
};

export function useMomentumScroll() {
  const points = useRef<{ x: number; y: number; time: number }[]>([]);
  const coastingFrame = useRef<number | undefined>(undefined);
  const activeVelocity = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const overscroll = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const activeTableRef = useRef<HTMLTableElement | null>(null);

  const resetTableTransform = useCallback((table: HTMLTableElement | null) => {
    if (!table) return;
    overscroll.current = { x: 0, y: 0 };
    resetTableBounce(table);
  }, []);

  const stop = useCallback(() => {
    if (coastingFrame.current !== undefined) {
      window.cancelAnimationFrame(coastingFrame.current);
      coastingFrame.current = undefined;
    }
    points.current = [];
    resetTableTransform(activeTableRef.current);
  }, [resetTableTransform]);

  const trackMove = useCallback((x: number, y: number) => {
    const previous = points.current.at(-1);
    const now = Math.max(Date.now(), previous?.time ?? 0);
    points.current.push({ x, y, time: now });
    points.current = points.current.filter((p) => now - p.time <= 120).slice(-8);
  }, []);

  const release = useCallback((viewport: HTMLDivElement, panAxis?: TablePanAxis, cachedBounds?: ReturnType<typeof getTableContentScrollBounds>) => {
    const table = viewport.querySelector?.('table') ?? null;
    activeTableRef.current = table;

    if (points.current.length < 2) return;
    const first = points.current[0];
    const last = points.current[points.current.length - 1];
    const dt = Math.max(1, last.time - first.time);

    const rawVx = (last.x - first.x) / dt;
    const rawVy = (last.y - first.y) / dt;

    // Stack residual velocity from previous coasting for consecutive swipe acceleration
    let vx = activeVelocity.current.vx * ACCELERATION_STACK_FACTOR + rawVx;
    let vy = activeVelocity.current.vy * ACCELERATION_STACK_FACTOR + rawVy;
    if (panAxis === 'x') vy = 0;
    if (panAxis === 'y') vx = 0;
    const preferredBounceAxis = panAxis === 'x' || panAxis === 'y'
      ? panAxis
      : Math.abs(vx) >= Math.abs(vy) ? 'x' : 'y';

    // Clamp speed limits
    vx = clampTableMomentumVelocity(vx);
    vy = clampTableMomentumVelocity(vy);

    points.current = [];
    // Save immediately so a second swipe that starts before the first rAF still
    // receives the residual velocity for acceleration stacking.
    activeVelocity.current = { vx, vy };
    const bounds = cachedBounds ?? getTableContentScrollBounds(viewport, table);
    let previousTimestamp: number | undefined;

    const coast = (timestamp: number) => {
      const elapsed = previousTimestamp === undefined
        ? FRAME_INTERVAL_MS
        : Math.min(MAX_FRAME_DELTA_MS, Math.max(1, timestamp - previousTimestamp));
      previousTimestamp = timestamp;
      activeVelocity.current = { vx, vy };

      const { maxLeft, maxTop } = bounds;
      const atBoundaryX = (viewport.scrollLeft <= 0 && vx > 0) || (viewport.scrollLeft >= maxLeft && vx < 0);
      const atBoundaryY = (viewport.scrollTop <= 0 && vy > 0) || (viewport.scrollTop >= maxTop && vy < 0);
      const activeBounceAxis = preferredBounceAxis;

      if (activeBounceAxis === 'x') {
        if (atBoundaryX) {
          vx *= 0.35;
          overscroll.current.x += vx * 3;
          overscroll.current.x = Math.max(-MAX_OVERSCROLL, Math.min(MAX_OVERSCROLL, overscroll.current.x));
        } else {
          overscroll.current.x *= 0.75;
        }
        overscroll.current.y = 0;
      } else {
        if (atBoundaryY) {
          vy *= 0.35;
          overscroll.current.y += vy * 3;
          overscroll.current.y = Math.max(-MAX_OVERSCROLL, Math.min(MAX_OVERSCROLL, overscroll.current.y));
        } else {
          overscroll.current.y *= 0.75;
        }
        overscroll.current.x = 0;
      }

      // CSS moves the content region with its matching header/row labels while keeping the corner fixed.
      if (table) {
        if (Math.abs(overscroll.current.x) > 0.5 || Math.abs(overscroll.current.y) > 0.5) {
          applyTableBounce(table, overscroll.current.x, overscroll.current.y);
        } else if (table.classList.contains('is-bouncing') || table.style.transform !== '') {
          resetTableBounce(table);
        }
      }

      const bounceOffset = activeBounceAxis === 'x' ? overscroll.current.x : overscroll.current.y;
      if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1 && Math.abs(bounceOffset) < 0.5) {
        activeVelocity.current = { vx: 0, vy: 0 };
        coastingFrame.current = undefined;
        resetTableTransform(table);
        return;
      }

      viewport.scrollLeft -= vx * elapsed;
      viewport.scrollTop -= vy * elapsed;
      const frameRatio = elapsed / FRAME_INTERVAL_MS;
      vx *= Math.pow(MOMENTUM_DECAY_PER_FRAME, frameRatio);
      vy *= Math.pow(MOMENTUM_DECAY_PER_FRAME, frameRatio);
      coastingFrame.current = window.requestAnimationFrame(coast);
    };

    coastingFrame.current = window.requestAnimationFrame(coast);
  }, [resetTableTransform]);

  const isCoasting = useCallback(() => coastingFrame.current !== undefined, []);

  return { stop, trackMove, release, isCoasting };
}
