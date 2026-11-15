// @vitest-environment node

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { execute, replay } = vi.hoisted(() => ({ execute: vi.fn(), replay: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: execute }));
vi.mock('../worker/workflows/attributeReplay', () => ({ runCompleteAttributeReplay: replay }));

const timestamp = 1_800_000_000_000;
const snapshot = { active_generation: timestamp, through_version: 41, chunk_count: 1, generated_at: timestamp };
const winMethod = { value_count: 2, min_rd: 1, max_rd: 2, evidence_values: 2 };

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  replay.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(timestamp);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

test('operator waits for full replay before verifying the published catalog', async () => {
  let finishReplay!: () => void;
  replay.mockReturnValue(new Promise<void>((resolve) => { finishReplay = resolve; }));
  execute
    .mockReturnValueOnce(JSON.stringify([{ results: [snapshot] }]))
    .mockReturnValueOnce(JSON.stringify([{ results: [winMethod] }]));

  const run = import('./rebuild-attribute-catalog');
  try {
    await vi.waitFor(() => expect(replay).toHaveBeenCalledExactlyOnceWith(expect.anything(), timestamp,
      expect.objectContaining({ compareLiveStates: true })));
    expect(execute).not.toHaveBeenCalled();
  } finally {
    finishReplay();
    await run;
  }
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0][1].at(-1)).toContain('FROM attribute_catalog_snapshot_state');
  expect(execute.mock.calls[1][1].at(-1)).toContain('FROM attribute_score_states');
  expect(console.log).toHaveBeenCalledWith(JSON.stringify({ replayed: true, snapshot, winMethod }));
});

test('operator does not verify or report success after replay fails', async () => {
  replay.mockRejectedValueOnce(new Error('replay failed'));
  await expect(import('./rebuild-attribute-catalog')).rejects.toThrow('replay failed');
  expect(execute).not.toHaveBeenCalled();
  expect(console.log).not.toHaveBeenCalled();
});
