import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishWorkspaceSteps, runWorkspaceCooperativeSteps, yieldWorkspaceTask } from './workspaceCooperativeWork';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('workspace cooperative work', () => {
  it('keeps a synchronous drain for callers that need one complete result', () => {
    const seen: number[] = [];
    const result = finishWorkspaceSteps((function* () {
      seen.push(1); yield;
      seen.push(2); yield;
      return 'complete';
    })());

    expect(result).toBe('complete');
    expect(seen).toEqual([1, 2]);
  });

  it('slices after roughly three milliseconds and resumes in a new task', async () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(4)
      .mockReturnValueOnce(5);
    const result = runWorkspaceCooperativeSteps((function* () {
      seen.push(0); yield;
      seen.push(1); yield;
      seen.push(2); yield;
      return 'complete';
    })(), () => undefined);

    expect(seen).toEqual([0, 1]);
    await vi.runOnlyPendingTimersAsync();
    await expect(result).resolves.toBe('complete');
    expect(seen).toEqual([0, 1, 2]);
    expect(now).toHaveBeenCalled();
  });

  it('checks current state after yielding before reading another step', async () => {
    vi.useFakeTimers();
    let current = true;
    const seen: string[] = [];
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(4);
    const result = runWorkspaceCooperativeSteps((function* () {
      seen.push('first'); yield;
      seen.push('cancelled-step'); yield;
      return 'unexpected';
    })(), () => { if (!current) throw new DOMException('cancelled', 'AbortError'); });
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });

    current = false;
    await vi.runOnlyPendingTimersAsync();
    await rejection;
    expect(seen).toEqual(['first']);
  });

  it('uses a zero-delay timer rather than running the continuation synchronously', async () => {
    vi.useFakeTimers();
    let completed = false;
    const result = yieldWorkspaceTask().then(() => { completed = true; });

    expect(completed).toBe(false);
    await vi.runOnlyPendingTimersAsync();
    await result;
    expect(completed).toBe(true);
  });
});
