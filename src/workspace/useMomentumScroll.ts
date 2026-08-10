import { useCallback, useRef } from 'react';

const MAX_VELOCITY = 65; // Max speed cap to prevent runaway acceleration
const ACCELERATION_STACK_FACTOR = 0.7; // Velocity retention ratio for consecutive swipes

export function useMomentumScroll() {
  const points = useRef<{ x: number; y: number; time: number }[]>([]);
  const coastingFrame = useRef<number | undefined>(undefined);
  const activeVelocity = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const overscroll = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const resetOverscroll = useCallback((viewport: HTMLDivElement) => {
    if (overscroll.current.x !== 0 || overscroll.current.y !== 0) {
      overscroll.current = { x: 0, y: 0 };
      viewport.style.transform = 'translate3d(0, 0, 0)';
      viewport.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
      setTimeout(() => {
        if (viewport) viewport.style.transition = '';
      }, 250);
    }
  }, []);

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
    if (dt === 0) return;

    const rawVx = (last.x - first.x) / dt;
    const rawVy = (last.y - first.y) / dt;

    // Stack residual velocity from previous coasting for consecutive swipe acceleration
    let vx = activeVelocity.current.vx * ACCELERATION_STACK_FACTOR + rawVx;
    let vy = activeVelocity.current.vy * ACCELERATION_STACK_FACTOR + rawVy;

    // Clamp total stacked velocity to prevent runaway speeds
    vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vx));
    vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, vy));

    points.current = [];

    const coast = () => {
      activeVelocity.current = { vx, vy };

      const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const atBoundaryX = (viewport.scrollLeft <= 0 && vx > 0) || (viewport.scrollLeft >= maxLeft && vx < 0);
      const atBoundaryY = (viewport.scrollTop <= 0 && vy > 0) || (viewport.scrollTop >= maxTop && vy < 0);

      if (atBoundaryX) {
        vx *= 0.45;
        overscroll.current.x += vx * 4;
        overscroll.current.x = Math.max(-45, Math.min(45, overscroll.current.x));
      } else {
        overscroll.current.x *= 0.8;
      }

      if (atBoundaryY) {
        vy *= 0.45;
        overscroll.current.y += vy * 4;
        overscroll.current.y = Math.max(-45, Math.min(45, overscroll.current.y));
      } else {
        overscroll.current.y *= 0.8;
      }

      // Apply 3D elastic offset for visual rubber-band recoil on desktop and mobile
      if (Math.abs(overscroll.current.x) > 0.5 || Math.abs(overscroll.current.y) > 0.5) {
        viewport.style.transform = `translate3d(${overscroll.current.x.toFixed(1)}px, ${overscroll.current.y.toFixed(1)}px, 0px)`;
      } else if (viewport.style.transform !== 'translate3d(0px, 0px, 0px)' && viewport.style.transform !== '') {
        viewport.style.transform = 'translate3d(0px, 0px, 0px)';
      }

      if (Math.abs(vx) < 0.15 && Math.abs(vy) < 0.15 && Math.abs(overscroll.current.x) < 0.5 && Math.abs(overscroll.current.y) < 0.5) {
        activeVelocity.current = { vx: 0, vy: 0 };
        coastingFrame.current = undefined;
        resetOverscroll(viewport);
        return;
      }

      viewport.scrollLeft -= vx * 16;
      viewport.scrollTop -= vy * 16;
      vx *= 0.975;
      vy *= 0.975;
      coastingFrame.current = window.requestAnimationFrame(coast);
    };

    coastingFrame.current = window.requestAnimationFrame(coast);
  }, [resetOverscroll]);

  const isCoasting = useCallback(() => coastingFrame.current !== undefined, []);

  return { stop, trackMove, release, isCoasting };
}
