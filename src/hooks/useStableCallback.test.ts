import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStableCallback } from './useStableCallback';

describe('useStableCallback', () => {
  it('keeps the handler stable while calling the latest callback with its typed arguments and result', () => {
    const stale = vi.fn((label: string, count: number) => `${label}:${count}`);
    const latest = vi.fn((label: string, count: number) => `${label}:${count * 2}`);
    const { result, rerender } = renderHook(
      ({ callback }: { callback: (label: string, count: number) => string }) => useStableCallback(callback),
      { initialProps: { callback: stale } },
    );
    const originalHandler = result.current;

    rerender({ callback: latest });

    expect(result.current).toBe(originalHandler);
    expect(originalHandler('score', 3)).toBe('score:6');
    expect(latest).toHaveBeenCalledExactlyOnceWith('score', 3);
    expect(stale).not.toHaveBeenCalled();
  });
});
