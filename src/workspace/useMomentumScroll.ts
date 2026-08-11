import { useCallback, useRef } from 'react';

const MAX_VELOCITY = 60; // Max speed cap for consecutive swipe acceleration
const ACCELERATION_STACK_FACTOR = 0.65; // Stack residual speed from previous swipe
const MAX_OVERSCROLL = 32; // Safe visual rubber-band offset limit (px)

export type TableBounceAxis = 'x' | 'y';

export const applyTableBounce = (table: HTMLTableElement | null, x: number, y: number) => {
  if (!table) return;
  table.style.setProperty('--workspace-bounce-x', `${x.toFixed(1)}px`);
  table.style.setProperty('--workspace-bounce-y', `${y.toFixed(1)}px`);
  table.classList.toggle('is-bouncing', Math.abs(x) > 0.5 || Math.abs(y) > 0.5);
  table.classList.remove('is-bounce-settling');
  table.style.transform = '';
};

export const resetTableBounce = (table: HTMLTableElement | null) => {
  if (!table) return;
  table.style.removeProperty('--workspace-bounce-x');
  table.style.removeProperty('--workspace-bounce-y');
  table.classList.remove('is-bouncing');
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
    const now = Date.now();
    points.current.push({ x, y, time: now });
    points.current = points.current.filter((p) => now - p.time <= 100).slice(-5);
  }, []);

  const release = useCallback((viewport: HTMLDivElement, bounceAxis?: TableBounceAxis) => {
    const table = viewport.querySelector?.('table') ?? null;
    activeTableRef.current = table;

    if (points.current.length < 2) return;
    const first = points.current[0];
    const last = points.current[points.current.length - 1];
    const dt = last.time - first.time;
    if (dt <= 0) return;

    const rawVx = (last.x - first.x) / dt;
    const rawVy = (last.y - first.y) / dt;

    // Stack residual velocity from previous coasting for consecutive swipe acceleration
    let vx = activeVelocity.current.vx * ACCELERATION_STACK_FACTOR + rawVx;
    let vy = activeVelocity.current.vy * ACCELERATION_STACK_FACTOR + rawVy;
    const preferredBounceAxis = bounceAxis ?? (Math.abs(vx) >= Math.abs(vy) ? 'x' : 'y');

    // Clamp speed limits
    vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vx));
    vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vy));

    points.current = [];

    const coast = () => {
      activeVelocity.current = { vx, vy };

      const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const atBoundaryX = (viewport.scrollLeft <= 0 && vx > 0) || (viewport.scrollLeft >= maxLeft && vx < 0);
      const atBoundaryY = (viewport.scrollTop <= 0 && vy > 0) || (viewport.scrollTop >= maxTop && vy < 0);
      const activeBounceAxis = atBoundaryX && !atBoundaryY ? 'x' : atBoundaryY && !atBoundaryX ? 'y' : preferredBounceAxis;

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

      // Apply the elastic offset to body cells only, leaving sticky headers and the first column fixed.
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

      viewport.scrollLeft -= vx * 16;
      viewport.scrollTop -= vy * 16;
      vx *= 0.965;
      vy *= 0.965;
      coastingFrame.current = window.requestAnimationFrame(coast);
    };

    coastingFrame.current = window.requestAnimationFrame(coast);
  }, [resetTableTransform]);

  const isCoasting = useCallback(() => coastingFrame.current !== undefined, []);

  return { stop, trackMove, release, isCoasting };
}
