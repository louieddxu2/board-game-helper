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
    if (!window.requestAnimationFrame) Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: () => 0 });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.useFakeTimers();
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
    if (!window.requestAnimationFrame) Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: () => 0 });
    if (!window.cancelAnimationFrame) Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: () => undefined });
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
    vi.useFakeTimers();
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
