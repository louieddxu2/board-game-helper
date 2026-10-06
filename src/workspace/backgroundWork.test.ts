import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterWorkspacePaint } from './backgroundWork';

describe('optional workspace work after paint', () => {
  let frame: FrameRequestCallback;
  let idle: IdleRequestCallback;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 12; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => { idle = callback; return 34; }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('waits for a paint and an idle slot before starting optional reads', () => {
    const work = vi.fn();
    afterWorkspacePaint(work, true);
    expect(work).not.toHaveBeenCalled();
    frame(0);
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(work).not.toHaveBeenCalled();
    idle({ didTimeout: false, timeRemaining: () => 20 });
    expect(work).toHaveBeenCalledOnce();
  });

  it('cancels a scheduled idle read when its table is no longer visible', () => {
    const work = vi.fn();
    const cancel = afterWorkspacePaint(work, true);
    frame(0); vi.runAllTimers(); cancel();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(34);
    expect(work).not.toHaveBeenCalled();
  });

  it('cancels optional work before the timer following paint runs', () => {
    const work = vi.fn();
    const cancel = afterWorkspacePaint(work, true);
    frame(0); cancel(); vi.runAllTimers();
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('still yields a paint in browsers without idle callbacks', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const work = vi.fn();
    afterWorkspacePaint(work, true);
    frame(0);
    expect(work).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(work).toHaveBeenCalledOnce();
  });
});
