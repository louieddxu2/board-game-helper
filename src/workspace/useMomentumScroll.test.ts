import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useMomentumScroll } from './useMomentumScroll';

describe('useMomentumScroll', () => {
  test('initializes with inactive coasting state', () => {
    const { result } = renderHook(() => useMomentumScroll());
    expect(result.current.isCoasting()).toBe(false);
  });

  test('stacks velocity when tracking consecutive quick swipes', () => {
    const { result } = renderHook(() => useMomentumScroll());
    const mockViewport = {
      scrollWidth: 2000,
      clientWidth: 500,
      scrollHeight: 2000,
      clientHeight: 500,
      scrollLeft: 200,
      scrollTop: 200,
      style: { transform: '', transition: '' },
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
});
