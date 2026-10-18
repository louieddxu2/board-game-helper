import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withSnapshotLease } from './snapshotLease';

const HEARTBEAT_MS = 15 * 60_000;

describe('snapshot lease heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renews a long-running action before the one-hour server lease expires', async () => {
    const renew = vi.fn(async () => undefined);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const action = vi.fn(async (check: () => Promise<void>) => {
      await pending;
      await check();
      return 'complete';
    });
    const running = withSnapshotLease(renew, action);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(renew).toHaveBeenCalledTimes(2);
    release();
    await expect(running).resolves.toBe('complete');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it('blocks finalization when a renewal throws synchronously', async () => {
    const failure = new Error('lease renewal failed');
    const renew = vi.fn(() => { throw failure; }) as unknown as () => Promise<unknown>;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let checkLease!: () => Promise<void>;
    const running = withSnapshotLease(renew, async check => {
      checkLease = check;
      await pending;
      await checkLease();
      return 'must not finalize';
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    release();
    await expect(running).rejects.toBe(failure);
    expect(renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'] as const)('cancels the timer after %s', async outcome => {
    const renew = vi.fn(async () => undefined);
    const running = withSnapshotLease(renew, async () => {
      if (outcome === 'failure') throw new Error('upload failed');
      return 'complete';
    });
    if (outcome === 'failure') await expect(running).rejects.toThrow('upload failed');
    else await expect(running).resolves.toBe('complete');
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(renew).not.toHaveBeenCalled();
  });
});
