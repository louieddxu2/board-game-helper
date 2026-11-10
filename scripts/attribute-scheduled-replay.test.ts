// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { scheduled } from '../worker';
import { ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE, queryAttributeReplayWork, queryCompletedReplayAttributes } from '../worker/data/attributeReplayWork';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';
import { close, establishBaseline, scoreRows, status, subjects } from './attributeReplayTestHarness';

const monday = Date.parse('2026-11-16T01:00:00Z');
const day = 24 * 60 * 60 * 1_000;

test('weekly replay rolls back a failed final publication and the next daily run resumes it', async () => {
  const { harness } = await establishBaseline(({ sqlite }) => {
    sqlite.exec('DELETE FROM attribute_vote_responses');
  });
  const { sqlite, env, gateway } = harness;
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const [first, second] = subjects(harness);
    sqlite.prepare(`
      WITH RECURSIVE votes(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM votes WHERE n < ?
      )
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, comparison,
         activity_json, session_id, created_at, updated_at)
      SELECT printf('scheduled-vote-%06d', n), 'attribute_win_method', ?, ?,
        CASE WHEN n % 3 = 0 THEN 2 + n % 7 END, CASE WHEN n % 2 = 0 THEN 'A_HIGHER' ELSE 'B_HIGHER' END,
        '[]', 'scheduled-replay', ? + n % 3, ? + n % 3
      FROM votes
    `).run(ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE, first.id, second.id, monday - day, monday - day);

    const run = (scheduledTime: number) => scheduled({ scheduledTime }, env);
    const generation = () => sqlite.prepare('SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1').get();
    const previousGeneration = generation();
    const beforeScores = scoreRows(harness);
    const beforeStatus = status(harness);
    await run(monday - day);
    expect(await queryAttributeReplayWork(gateway)).toBeNull();
    expect(generation()).toEqual(previousGeneration);
    expect(info).toHaveBeenLastCalledWith('attribute_replay_scheduled', expect.objectContaining({
      weekly: false, outcome: 'idle', queries: 1,
    }));

    // Clear the saved job only after the new scores and catalog have been written.
    sqlite.exec(`
      CREATE TRIGGER fail_final_replay_cleanup BEFORE DELETE ON attribute_replay_work
      BEGIN SELECT RAISE(ABORT, 'injected final replay failure'); END
    `);
    await expect(run(monday)).rejects.toThrow('injected final replay failure');
    expect(scoreRows(harness)).toEqual(beforeScores);
    expect(generation()).toEqual(previousGeneration);
    expect(status(harness)).toEqual(beforeStatus);
    expect(await queryAttributeReplayWork(gateway)).toMatchObject({
      scanned_rowid: ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE, target_rowid: ATTRIBUTE_REPLAY_HISTORY_PAGE_SIZE,
    });
    expect((await queryCompletedReplayAttributes(gateway)).has('attribute_win_method')).toBe(true);
    expect(sqlite.prepare("SELECT token FROM attribute_vote_lock WHERE lock_name = 'attribute-replay'").get()).toBeUndefined();
    expect(info).toHaveBeenLastCalledWith('attribute_replay_scheduled', expect.objectContaining({
      weekly: true, outcome: 'failed', durationMs: expect.any(Number),
      queries: expect.any(Number), rowsRead: expect.any(Number), rowsWritten: expect.any(Number),
    }));

    sqlite.exec('DROP TRIGGER fail_final_replay_cleanup');
    await run(monday + day);
    expect(generation()).toEqual({ active_generation: monday + day });
    expect(await queryAttributeReplayWork(gateway)).toBeNull();
    expect(status(harness).replayed_revision).toBe(beforeStatus.required_revision);
    expect(info).toHaveBeenLastCalledWith('attribute_replay_scheduled', expect.objectContaining({
      weekly: false, outcome: 'replay',
    }));
    const resumedScores = scoreRows(harness);
    expect(resumedScores).not.toEqual(beforeScores);
    await runCompleteAttributeReplay(gateway, monday + day + 1, { compareLiveStates: true });
    expect(scoreRows(harness)).toEqual(resumedScores);

    harness.executedSql.length = 0;
    await run(monday + 7 * day);
    expect(info).toHaveBeenLastCalledWith('attribute_replay_scheduled', expect.objectContaining({
      weekly: true, outcome: 'cache',
    }));
    expect(harness.executedSql.some((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toBe(false);
  } finally {
    info.mockRestore();
    close(harness);
  }
});
