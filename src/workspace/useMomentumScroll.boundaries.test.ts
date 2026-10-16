import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useMomentumScroll } from './useMomentumScroll';

type ScrollAxis = 'x' | 'y';

type ScrollWrite = {
  axis: ScrollAxis;
  requested: number;
  actual: number;
};

type ViewportFixture = {
  viewport: HTMLDivElement;
  actualMaxLeft: number;
  actualMaxTop: number;
  writes: ScrollWrite[];
  position: () => { left: number; top: number };
};

type RafController = {
  pending: Map<number, FrameRequestCallback>;
  run: (timestamp: number) => void;
  restore: () => void;
};

const FRAME_MS = 1000 / 60;
const CACHED_BOUNDARY_PADDING = 64;

const createViewport = ({
  initialLeft,
  initialTop,
  actualMaxLeft,
  actualMaxTop,
  roundNativeValues = false,
}: {
  initialLeft: number;
  initialTop: number;
  actualMaxLeft: number;
  actualMaxTop: number;
  roundNativeValues?: boolean;
}): ViewportFixture => {
  const viewport = document.createElement('div');
  const table = document.createElement('table');
  viewport.append(table);
  const writes: ScrollWrite[] = [];
  let scrollLeft = initialLeft;
  let scrollTop = initialTop;
  const nativeScrollValue = (value: number, maximum: number) => {
    const clamped = Math.max(0, Math.min(maximum, value));
    return roundNativeValues ? Math.round(clamped) : clamped;
  };

  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 500 },
    clientHeight: { configurable: true, value: 500 },
    scrollWidth: { configurable: true, value: 500 + actualMaxLeft },
    scrollHeight: { configurable: true, value: 500 + actualMaxTop },
    scrollLeft: {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        const requested = Number(value);
        scrollLeft = nativeScrollValue(requested, actualMaxLeft);
        writes.push({ axis: 'x', requested, actual: scrollLeft });
      },
    },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        const requested = Number(value);
        scrollTop = nativeScrollValue(requested, actualMaxTop);
        writes.push({ axis: 'y', requested, actual: scrollTop });
      },
    },
  });

  return {
    viewport,
    actualMaxLeft,
    actualMaxTop,
    writes,
    position: () => ({ left: scrollLeft, top: scrollTop }),
  };
};

const installRafController = (): RafController => {
  const previousRequestAnimationFrame = window.requestAnimationFrame;
  const previousCancelAnimationFrame = window.cancelAnimationFrame;
  const pending = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;

  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      pending.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (id: number) => { pending.delete(id); },
  });

  return {
    pending,
    run: (timestamp: number) => {
      const next = pending.entries().next();
      expect(next.done).toBe(false);
      const [id, callback] = next.value as [number, FrameRequestCallback];
      pending.delete(id);
      callback(timestamp);
    },
    restore: () => {
      pending.clear();
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        writable: true,
        value: previousRequestAnimationFrame,
      });
      Object.defineProperty(window, 'cancelAnimationFrame', {
        configurable: true,
        writable: true,
        value: previousCancelAnimationFrame,
      });
    },
  };
};

const releaseFling = (
  result: { current: ReturnType<typeof useMomentumScroll> },
  fixture: ViewportFixture,
  panAxis: 'x' | 'y' | 'both',
  first: { x: number; y: number },
  last: { x: number; y: number },
  cachedBounds = {
    maxLeft: fixture.actualMaxLeft + CACHED_BOUNDARY_PADDING,
    maxTop: fixture.actualMaxTop + CACHED_BOUNDARY_PADDING,
  },
) => {
  const now = 1_000_000;
  vi.setSystemTime(now);
  result.current.trackMove(first.x, first.y);
  vi.setSystemTime(now + 40);
  result.current.trackMove(last.x, last.y);
  result.current.release(fixture.viewport, panAxis, cachedBounds);
};

const outOfRangeWrites = (fixture: ViewportFixture, axis: ScrollAxis) => (
  fixture.writes.filter((write) => write.axis === axis && Math.abs(write.requested - write.actual) > 1)
);

describe('useMomentumScroll native boundary behavior', () => {
  test.each([
    ['top', 0, { x: 0, y: 0 }, { x: 0, y: 100 }],
    ['bottom', 1_500, { x: 0, y: 100 }, { x: 0, y: 0 }],
  ] as const)('does not report an immovable %s coast before its first frame', (_edge, initialTop, first, last) => {
    const { result } = renderHook(() => useMomentumScroll());
    const fixture = createViewport({ initialLeft: 20, initialTop, actualMaxLeft: 1_000, actualMaxTop: 1_500 });
    const raf = installRafController();

    try {
      releaseFling(result, fixture, 'y', first, last, { maxLeft: fixture.actualMaxLeft, maxTop: fixture.actualMaxTop });

      expect(raf.pending.size).toBe(1);
      expect(result.current.isCoasting()).toBe(false);
    } finally {
      result.current.stop();
      raf.restore();
    }
  });

  test('reports diagonal coasting before its first frame when only one axis is blocked', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const fixture = createViewport({ initialLeft: 1_000, initialTop: 500, actualMaxLeft: 1_000, actualMaxTop: 1_500 });
    const raf = installRafController();

    try {
      releaseFling(result, fixture, 'both', { x: 100, y: 100 }, { x: 0, y: 0 }, { maxLeft: fixture.actualMaxLeft, maxTop: fixture.actualMaxTop });

      expect(raf.pending.size).toBe(1);
      expect(result.current.isCoasting()).toBe(true);
    } finally {
      result.current.stop();
      raf.restore();
    }
  });

  test('does not restart a fling from samples that became stale during a stationary hold', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const fixture = createViewport({ initialLeft: 20, initialTop: 500, actualMaxLeft: 1_000, actualMaxTop: 1_500 });
    const raf = installRafController();
    const initialTop = fixture.position().top;

    try {
      vi.setSystemTime(1_000_000);
      result.current.trackMove(0, 100);
      vi.setSystemTime(1_000_016);
      result.current.trackMove(0, 80);
      vi.setSystemTime(1_000_216);
      result.current.release(fixture.viewport, 'y');

      expect(fixture.position().top).toBe(initialTop);
      expect(raf.pending.size).toBe(0);
      expect(result.current.isCoasting()).toBe(false);
    } finally {
      result.current.stop();
      raf.restore();
    }
  });

  test('keeps fresh fast samples and stacks residual velocity after an immediate stop', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const fixture = createViewport({ initialLeft: 20, initialTop: 500, actualMaxLeft: 1_000, actualMaxTop: 1_500 });
    const raf = installRafController();

    try {
      releaseFling(result, fixture, 'y', { x: 0, y: 100 }, { x: 0, y: 0 });
      raf.run(0);
      const firstDelta = fixture.position().top - 500;
      expect(firstDelta).toBeGreaterThan(0);

      result.current.stop();
      const secondStart = fixture.position().top;
      releaseFling(result, fixture, 'y', { x: 0, y: 100 }, { x: 0, y: 0 });
      raf.run(FRAME_MS);

      expect(fixture.position().top - secondStart).toBeGreaterThan(firstDelta);
      expect(result.current.isCoasting()).toBe(true);
    } finally {
      result.current.stop();
      raf.restore();
    }
  });

  test('vertical coast stops at the actual native bottom when the cached bottom is stale', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const fixture = createViewport({ initialLeft: 20, initialTop: 120, actualMaxLeft: 500, actualMaxTop: 150 });
    const raf = installRafController();

    try {
      releaseFling(result, fixture, 'y', { x: 0, y: 101 }, { x: 0, y: 0 });
      raf.run(0);
      if (raf.pending.size > 0) raf.run(FRAME_MS);

      expect(fixture.position().top).toBe(fixture.actualMaxTop);
      expect(result.current.isCoasting()).toBe(false);
      expect(outOfRangeWrites(fixture, 'y')).toHaveLength(1);
    } finally {
      result.current.stop();
      raf.restore();
    }
  });

  test('horizontal coast stops at the actual native right edge when the cached edge is stale', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const fixture = createViewport({ initialLeft: 120, initialTop: 20, actualMaxLeft: 150, actualMaxTop: 500 });
    const raf = installRafController();

    try {
      releaseFling(result, fixture, 'x', { x: 101, y: 0 }, { x: 0, y: 0 });
      raf.run(0);
      if (raf.pending.size > 0) raf.run(FRAME_MS);

      expect(fixture.position().left).toBe(fixture.actualMaxLeft);
      expect(result.current.isCoasting()).toBe(false);
      expect(outOfRangeWrites(fixture, 'x')).toHaveLength(1);
    } finally {
      result.current.stop();
      raf.restore();
    }
  });

  test('stops a blocked diagonal axis while the other axis keeps coasting', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const fixture = createViewport({ initialLeft: 120, initialTop: 100, actualMaxLeft: 150, actualMaxTop: 400 });
    const raf = installRafController();

    try {
      releaseFling(result, fixture, 'both', { x: 101, y: 101 }, { x: 0, y: 0 });
      raf.run(0);
      const afterFirstFrame = fixture.position();
      raf.run(FRAME_MS);
      const afterSecondFrame = fixture.position();

      expect(afterFirstFrame.left).toBe(fixture.actualMaxLeft);
      expect(afterSecondFrame.left).toBe(fixture.actualMaxLeft);
      expect(afterSecondFrame.top).toBeGreaterThan(afterFirstFrame.top);
      expect(result.current.isCoasting()).toBe(true);
      expect(outOfRangeWrites(fixture, 'x')).toHaveLength(1);
    } finally {
      result.current.stop();
      raf.restore();
    }
  });

  test('does not stop an interior coast for native rounding of one pixel or less', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const fixture = createViewport({
      initialLeft: 20,
      initialTop: 100,
      actualMaxLeft: 1_000,
      actualMaxTop: 1_000,
      roundNativeValues: true,
    });
    const raf = installRafController();

    try {
      releaseFling(result, fixture, 'y', { x: 0, y: 101 }, { x: 0, y: 0 }, { maxLeft: 1_000, maxTop: 1_000 });
      raf.run(0);
      const afterFirstFrame = fixture.position().top;
      raf.run(FRAME_MS);
      const afterSecondFrame = fixture.position().top;

      expect(afterSecondFrame).toBeGreaterThan(afterFirstFrame);
      expect(result.current.isCoasting()).toBe(true);
      expect(fixture.writes
        .filter((write) => write.axis === 'y')
        .every((write) => Math.abs(write.requested - write.actual) <= 1)).toBe(true);
    } finally {
      result.current.stop();
      raf.restore();
    }
  });
});
