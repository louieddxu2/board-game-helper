import { useCallback, useRef } from 'react';

export function useMomentumScroll() {
  const points = useRef<{ x: number; y: number; time: number }[]>([]);
  const coastingFrame = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    if (coastingFrame.current !== undefined) window.cancelAnimationFrame(coastingFrame.current);
    coastingFrame.current = undefined;
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

    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;

    points.current = [];

    const coast = () => {
      if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
        coastingFrame.current = undefined;
        return;
      }
      viewport.scrollLeft -= vx * 16;
      viewport.scrollTop -= vy * 16;
      vx *= 0.95;
      vy *= 0.95;
      coastingFrame.current = window.requestAnimationFrame(coast);
    };
    coastingFrame.current = window.requestAnimationFrame(coast);
  }, []);

  const isCoasting = useCallback(() => coastingFrame.current !== undefined, []);

  return { stop, trackMove, release, isCoasting };
}
