import { useCallback, useRef } from 'react';

const MAX_VELOCITY = 60; // Max speed cap for consecutive swipe acceleration
const ACCELERATION_STACK_FACTOR = 0.65; // Stack residual speed from previous swipe

export function useMomentumScroll() {
  const points = useRef<{ x: number; y: number; time: number }[]>([]);
  const coastingFrame = useRef<number | undefined>(undefined);
  const activeVelocity = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });

  const stop = useCallback(() => {
    if (coastingFrame.current !== undefined) {
      window.cancelAnimationFrame(coastingFrame.current);
      coastingFrame.current = undefined;
    }
    points.current = [];
  }, []);

  const trackMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    points.current.push({ x, y, time: now });
    points.current = points.current.filter((p) => now - p.time <= 100).slice(-5);
  }, []);

  const release = useCallback((viewport: HTMLDivElement) => {
    if (points.current.length < 2) return;
    const first = points.current[0];
    const last = points.current[points.current.length - 1];
    const dt = last.time - first.time;
    if (dt <= 0) return;

    const rawVx = (last.x - first.x) / dt;
    const rawVy = (last.y - first.y) / dt;

    // Stack residual velocity if previous swipe was still coasting for consecutive acceleration
    let vx = activeVelocity.current.vx * ACCELERATION_STACK_FACTOR + rawVx;
    let vy = activeVelocity.current.vy * ACCELERATION_STACK_FACTOR + rawVy;

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

      if (atBoundaryX) vx *= 0.3; // Rapidly damp speed at boundary limits
      if (atBoundaryY) vy *= 0.3;

      if (Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) {
        activeVelocity.current = { vx: 0, vy: 0 };
        coastingFrame.current = undefined;
        return;
      }

      viewport.scrollLeft -= vx * 16;
      viewport.scrollTop -= vy * 16;
      vx *= 0.965;
      vy *= 0.965;
      coastingFrame.current = window.requestAnimationFrame(coast);
    };

    coastingFrame.current = window.requestAnimationFrame(coast);
  }, []);

  const isCoasting = useCallback(() => coastingFrame.current !== undefined, []);

  return { stop, trackMove, release, isCoasting };
}
