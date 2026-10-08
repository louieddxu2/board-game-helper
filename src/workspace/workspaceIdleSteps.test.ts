import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWorkspaceIdleSteps } from './workspaceIdleSteps';

const oneStep = (seen: string[], value = 'done') => (function* () {
  seen.push('step');
  yield;
  return value;
})();

describe('workspace idle step runner', () => {
  let idle: IdleRequestCallback | undefined;
  let frame: FrameRequestCallback | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    idle = undefined;
    frame = undefined;
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => { idle = callback; return 17; }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 23; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('pauses for 150ms while canRun is false, then resumes in a later idle slot', async () => {
    const seen: string[] = [];
    let allowed = false;
    const controller = new AbortController();
    const result = runWorkspaceIdleSteps(oneStep(seen), {
      signal: controller.signal,
      isCurrent: () => true,
      canRun: () => allowed,
    });

    idle!({ didTimeout: false, timeRemaining: () => 20 });
    expect(seen).toEqual([]);
    expect(idle).toBeDefined();
    allowed = true;
    await vi.advanceTimersByTimeAsync(149);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    idle!({ didTimeout: false, timeRemaining: () => 20 });
    await expect(result).resolves.toBe('done');
    expect(seen).toEqual(['step']);
  });

  it('resolves undefined and cancels a pending idle callback when aborted', async () => {
    const controller = new AbortController();
    const result = runWorkspaceIdleSteps(oneStep([]), { signal: controller.signal, isCurrent: () => true, canRun: () => true });

    controller.abort();

    await expect(result).resolves.toBeUndefined();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(17);
  });

  it('resolves undefined when the table is no longer current before the slot runs', async () => {
    let current = true;
    const seen: string[] = [];
    const result = runWorkspaceIdleSteps(oneStep(seen), { signal: new AbortController().signal, isCurrent: () => current, canRun: () => true });

    current = false;
    idle!({ didTimeout: false, timeRemaining: () => 20 });

    await expect(result).resolves.toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('limits a long no-deadline run to roughly a 3ms CPU slice before yielding again', async () => {
    const seen: number[] = [];
    const controller = new AbortController();
    const generator = (function* () {
      for (let index = 0; index < 3; index += 1) { seen.push(index); yield; }
      return 'complete';
    })();
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(5);
    const result = runWorkspaceIdleSteps(generator, { signal: controller.signal, isCurrent: () => true, canRun: () => true });

    const firstIdle = idle!;
    firstIdle({ didTimeout: false, timeRemaining: () => 20 });
    expect(seen).toEqual([0, 1]);
    expect(idle).toBeDefined();
    idle!({ didTimeout: false, timeRemaining: () => 20 });
    await expect(result).resolves.toBe('complete');
    now.mockRestore();
  });

  it('uses a paint callback and timer when requestIdleCallback is unavailable', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const seen: string[] = [];
    const result = runWorkspaceIdleSteps(oneStep(seen), { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true });

    expect(frame).toBeDefined();
    expect(seen).toEqual([]);
    frame!(0);
    expect(seen).toEqual([]);
    await vi.runOnlyPendingTimersAsync();
    await expect(result).resolves.toBe('done');
    expect(seen).toEqual(['step']);
  });
});
