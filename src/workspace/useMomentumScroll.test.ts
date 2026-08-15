import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { clampTableMomentumVelocity, getTablePanAxis, MAX_TABLE_MOMENTUM_VELOCITY, useMomentumScroll } from './useMomentumScroll';

describe('useMomentumScroll', () => {
  test('locks clear horizontal and vertical gestures while preserving near-diagonal movement', () => {
    expect(getTablePanAxis(100, 20)).toBe('x');
    expect(getTablePanAxis(20, -100)).toBe('y');
    expect(getTablePanAxis(100, 90)).toBe('both');
    expect(getTablePanAxis(-90, 100)).toBe('both');
  });

  test('initializes with inactive coasting state', () => {
    const { result } = renderHook(() => useMomentumScroll());
    expect(result.current.isCoasting()).toBe(false);
  });

  test('stacks velocity for consecutive swipes', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const mockViewport = {
      scrollWidth: 2000,
      clientWidth: 500,
      scrollHeight: 2000,
      clientHeight: 500,
      scrollLeft: 200,
      scrollTop: 200,
    } as unknown as HTMLDivElement;

    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    result.current.trackMove(0, 0);
    vi.setSystemTime(now + 40);
    result.current.trackMove(50, 0);
    result.current.release(mockViewport);

    expect(result.current.isCoasting()).toBe(true);

    vi.setSystemTime(now + 80);
    result.current.trackMove(50, 0);
    vi.setSystemTime(now + 120);
    result.current.trackMove(120, 0);
    result.current.release(mockViewport);

    expect(result.current.isCoasting()).toBe(true);
    vi.useRealTimers();
  });

  test('keeps rapid consecutive swipes accelerated even before the first animation frame', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const viewport = {
      scrollWidth: 2000,
      clientWidth: 500,
      scrollHeight: 2000,
      clientHeight: 500,
      scrollLeft: 500,
      scrollTop: 200,
    } as unknown as HTMLDivElement;
    const frames: FrameRequestCallback[] = [];
    vi.useFakeTimers();
    if (!window.requestAnimationFrame) Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: () => 0 });
    if (!window.cancelAnimationFrame) Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: () => undefined });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const now = Date.now();
    vi.setSystemTime(now);
    result.current.trackMove(0, 0);
    vi.setSystemTime(now + 40);
    result.current.trackMove(40, 0);
    result.current.release(viewport, 'x');
    result.current.stop();

    vi.setSystemTime(now + 80);
    result.current.trackMove(40, 0);
    vi.setSystemTime(now + 120);
    result.current.trackMove(80, 0);
    result.current.release(viewport, 'x');
    frames.at(-1)?.(0);

    // 1 px/ms from the second swipe plus the retained 0.65 px/ms from the first.
    expect(viewport.scrollLeft).toBeCloseTo(500 - (1.65 * (1000 / 60)), 1);
    expect(cancelAnimationFrame).toHaveBeenCalled();

    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
    vi.useRealTimers();
  });

  test('uses elapsed animation time so a delayed frame does not slow momentum', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const viewport = {
      scrollWidth: 2000,
      clientWidth: 500,
      scrollHeight: 2000,
      clientHeight: 500,
      scrollLeft: 500,
      scrollTop: 200,
    } as unknown as HTMLDivElement;
    const frames: FrameRequestCallback[] = [];
    vi.useFakeTimers();
    if (!window.requestAnimationFrame) Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: () => 0 });
    if (!window.cancelAnimationFrame) Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: () => undefined });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const now = Date.now();
    vi.setSystemTime(now);
    result.current.trackMove(0, 0);
    vi.setSystemTime(now + 40);
    result.current.trackMove(100, 0);
    result.current.release(viewport, 'x');
    frames.shift()?.(0);
    frames.shift()?.(32);

    // The second frame represents 32ms, so it should advance substantially
    // farther than the old fixed-16ms integrator did.
    expect(viewport.scrollLeft).toBeLessThan(400);

    result.current.stop();
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
    vi.useRealTimers();
  });

  test('crosses 200 dense rows after three full phone-style upward flings', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const rowHeight = 28;
    const viewport = {
      scrollWidth: 2000,
      clientWidth: 500,
      scrollHeight: 100000,
      clientHeight: 500,
      scrollLeft: 0,
      scrollTop: 0,
    } as unknown as HTMLDivElement;
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.useFakeTimers();
    if (!window.requestAnimationFrame) Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: () => 0 });
    if (!window.cancelAnimationFrame) Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: () => undefined });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++nextFrameId;
      pendingFrames.set(id, callback);
      return id;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      pendingFrames.delete(id);
    });

    const runCoastToRest = () => {
      let timestamp = 0;
      let safety = 0;
      while (pendingFrames.size > 0 && safety < 1000) {
        const [id, callback] = pendingFrames.entries().next().value as [number, FrameRequestCallback];
        pendingFrames.delete(id);
        callback(timestamp);
        timestamp += 1000 / 60;
        safety += 1;
      }
      expect(safety).toBeLessThan(1000);
    };

    const now = Date.now();
    vi.setSystemTime(now);
    for (let swipe = 0; swipe < 3; swipe += 1) {
      vi.setSystemTime(now + (swipe * 140));
      result.current.trackMove(0, 320);
      vi.setSystemTime(now + (swipe * 140) + 100);
      result.current.trackMove(0, 0);
      result.current.release(viewport, 'y');
      runCoastToRest();
    }

    expect(viewport.scrollTop).toBeGreaterThanOrEqual(rowHeight * 200);

    result.current.stop();
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
    vi.useRealTimers();
  });

  test('makes repeated same-direction flings noticeably faster while the prior coast is active', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const viewport = {
      scrollWidth: 2000,
      clientWidth: 500,
      scrollHeight: 100000,
      clientHeight: 500,
      scrollLeft: 0,
      scrollTop: 1000,
    } as unknown as HTMLDivElement;
    const pendingFrames = new Map<number, FrameRequestCallback>();
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const previousCancelAnimationFrame = window.cancelAnimationFrame;
    let nextFrameId = 0;
    vi.useFakeTimers();
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => {
        const id = ++nextFrameId;
        pendingFrames.set(id, callback);
        return id;
      },
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: (id: number) => { pendingFrames.delete(id); },
    });
    const runFrame = (timestamp: number) => {
      const next = pendingFrames.entries().next();
      expect(next.done).toBe(false);
      const [id, callback] = next.value as [number, FrameRequestCallback];
      pendingFrames.delete(id);
      callback(timestamp);
    };
    const performSwipe = (startTime: number, reverse = false) => {
      const samples = reverse
        ? [[0, 0], [-2, 74], [1, 183], [0, 286], [2, 360]]
        : [[1, 360], [-1, 300], [0, 205], [-2, 96], [1, 0]];
      const sampleTimes = [0, 17, 43, 71, 103];
      samples.forEach(([x, y], index) => {
        vi.setSystemTime(startTime + sampleTimes[index]);
        result.current.trackMove(x, y);
      });
      result.current.release(viewport, 'y');
      const before = viewport.scrollTop;
      runFrame(0);
      return viewport.scrollTop - before;
    };

    try {
      const now = Date.now();
      const firstAdvance = performSwipe(now);
      // Let the first coast continue, then interrupt it with another swipe in
      // the same direction, as a user does with a quick repeated flick.
      runFrame(17);
      runFrame(34);
      result.current.stop();
      const secondAdvance = performSwipe(now + 180);
      runFrame(17);
      runFrame(34);
      result.current.stop();
      const thirdAdvance = performSwipe(now + 360);

      expect(firstAdvance).toBeGreaterThan(0);
      expect(secondAdvance).toBeGreaterThan(firstAdvance * 1.25);
      expect(thirdAdvance).toBeGreaterThan(secondAdvance * 1.15);

      result.current.stop();
      const reverseAdvance = performSwipe(now + 540, true);
      expect(reverseAdvance).toBeLessThan(0);
    } finally {
      pendingFrames.clear();
      vi.useRealTimers();
      Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: previousRequestAnimationFrame });
      Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: previousCancelAnimationFrame });
    }
  });

  test('applies boundary bounce to one selected axis of body cells', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const viewport = document.createElement('div');
    const table = document.createElement('table');
    const body = document.createElement('tbody');
    const row = document.createElement('tr');
    row.append(document.createElement('td'));
    body.append(row);
    table.append(body);
    viewport.append(table);
    Object.defineProperties(viewport, {
      scrollWidth: { configurable: true, value: 2000 },
      clientWidth: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTop: { configurable: true, writable: true, value: 200 },
    });
    const frames: FrameRequestCallback[] = [];
    vi.useFakeTimers();
    if (!window.requestAnimationFrame) Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: () => 0 });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    if (!window.cancelAnimationFrame) Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: () => undefined });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const now = Date.now();
    vi.setSystemTime(now);
    result.current.trackMove(0, 0);
    vi.setSystemTime(now + 40);
    result.current.trackMove(50, 20);
    result.current.release(viewport, 'x');
    frames.shift()?.(0);

    expect(table.classList.contains('is-bouncing')).toBe(true);
    expect(table.style.getPropertyValue('--workspace-bounce-x')).not.toBe('0px');
    expect(table.style.getPropertyValue('--workspace-bounce-y')).toBe('0.0px');

    result.current.stop();
    requestAnimationFrame.mockRestore();
    vi.useRealTimers();
  });

  test('does not bounce the secondary axis when only that axis reaches a boundary', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const viewport = document.createElement('div');
    const table = document.createElement('table');
    viewport.append(table);
    Object.defineProperties(viewport, {
      scrollWidth: { configurable: true, value: 2000 }, clientWidth: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 500 },
      scrollLeft: { configurable: true, writable: true, value: 0 }, scrollTop: { configurable: true, writable: true, value: 200 },
    });
    const frames: FrameRequestCallback[] = [];
    vi.useFakeTimers();
    if (!window.requestAnimationFrame) Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: () => 0 });
    if (!window.cancelAnimationFrame) Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: () => undefined });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
    const now = Date.now();
    vi.setSystemTime(now);
    result.current.trackMove(0, 0);
    vi.setSystemTime(now + 40);
    result.current.trackMove(15, 50);
    result.current.release(viewport, 'y');
    frames.shift()?.(0);

    expect(table.classList.contains('is-bounce-x')).toBe(false);
    expect(table.style.getPropertyValue('--workspace-bounce-x')).toBe('');

    result.current.stop();
    requestAnimationFrame.mockRestore();
    vi.useRealTimers();
  });

  test('allows a faster fling before applying the momentum cap', () => {
    expect(MAX_TABLE_MOMENTUM_VELOCITY).toBeGreaterThan(60);
    expect(clampTableMomentumVelocity(250)).toBe(MAX_TABLE_MOMENTUM_VELOCITY);
    expect(clampTableMomentumVelocity(-250)).toBe(-MAX_TABLE_MOMENTUM_VELOCITY);
  });
});
