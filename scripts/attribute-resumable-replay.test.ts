// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { attributeCatalogPayload, queryAttributeCatalogSnapshot } from '../worker/data/attributeCatalog';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { queryAttributeReplayWork, queryCompletedReplayAttributes } from '../worker/data/attributeReplayWork';
import { saveAttributeResponse } from '../worker/data/attributes';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';
import { resumePendingAttributeReplay } from '../worker/workflows/attributeResumableReplay';
import { runWeeklyAttributeRebuild } from '../worker/workflows/attributeWeeklyRebuild';
import { close, establishBaseline, scoreRows, status, subjects } from './attributeReplayTestHarness';

const workBudget = { minimumHistoryRowid: 0, pageSize: 2, maxSteps: 1 };
const attributeId = 'attribute_win_method';
const establishEmptyBaseline = () => establishBaseline(({ sqlite }) => {
  sqlite.exec('DELETE FROM attribute_vote_responses;');
});

test('resumes committed pages, catches up with a live vote, and matches a complete replay', async () => {
  const { harness, timestamp } = await establishEmptyBaseline();
  try {
    const { gateway, sqlite } = harness;
    const catalog = async () => attributeCatalogPayload(await queryAttributeCatalogSnapshot(gateway));
    const previous = await catalog();
    const previousScores = scoreRows(harness);
    const [first, second] = subjects(harness);
    const insert = sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, comparison, activity_json, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '[]', 'staged-replay', ?, ?)
    `);
    ['historical-Z', 'historical_a', 'historical-A', 'historical_b', 'historical-B'].forEach((id, index) => {
      insert.run(id, attributeId, first.id, second.id, index % 2 ? null : index + 1,
        index % 2 ? 'B_HIGHER' : 'A_HIGHER', timestamp + 90, timestamp + 90);
    });
    expect(await resumePendingAttributeReplay(gateway, timestamp + 1, workBudget)).toBeNull();
    await expect(runWeeklyAttributeRebuild(gateway, timestamp + 1, { workBudget })).resolves.toBe('pending');
    const firstPage = await queryAttributeReplayWork(gateway);
    expect(firstPage).toMatchObject({ scanned_rowid: 2, target_rowid: 5 });

    sqlite.exec(`
      CREATE TRIGGER fail_staged_page BEFORE UPDATE OF scanned_rowid ON attribute_replay_work
      BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END;
    `);
    await expect(resumePendingAttributeReplay(gateway, timestamp + 2, workBudget)).rejects.toThrow('injected checkpoint failure');
    expect(await queryAttributeReplayWork(gateway)).toEqual(firstPage);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM attribute_replay_work_chunks WHERE kind = 'history'").get()).toEqual({ count: 1 });
    expect(scoreRows(harness)).toEqual(previousScores);
    expect((await catalog()).generation).toBe(previous.generation);
    sqlite.exec('DROP TRIGGER fail_staged_page');

    await expect(resumePendingAttributeReplay(gateway, timestamp + 3, {
      ...workBudget, maxSteps: 2 + previous.attributes.length,
    })).resolves.toBe('pending');
    expect((await queryCompletedReplayAttributes(gateway)).size).toBe(previous.attributes.length);
    expect((await catalog()).generation).toBe(previous.generation);

    const revision = status(harness).required_revision;
    // The online timestamp is newer than the live state but earlier than the
    // staged comparisons. It must be inserted into the old sort order.
    await saveAttributeResponse(gateway, {
      subjectAId: first.id, subjectBId: second.id, attributeId, actorId: null,
      responseId: 'live-catchup', sessionId: 'staged-replay', comparison: 'A_HIGHER', timestamp: timestamp + 4,
    });
    expect(status(harness).required_revision).toBe(revision);
    await saveAttributeResponse(gateway, {
      subjectAId: first.id, subjectBId: second.id, attributeId, actorId: null,
      responseId: 'live-direct-rating', sessionId: 'staged-replay', ratingB: 7, timestamp: timestamp + 5,
    });
    expect(status(harness).required_revision).toBeGreaterThan(revision);
    await flushCatalogOutbox(gateway, timestamp + 6);
    await expect(resumePendingAttributeReplay(gateway, timestamp + 6, workBudget)).resolves.toBe('pending');
    expect(await queryAttributeReplayWork(gateway)).toMatchObject({ scanned_rowid: 7, target_rowid: 7 });
    expect((await queryCompletedReplayAttributes(gateway)).size).toBe(previous.attributes.length - 1);
    await expect(resumePendingAttributeReplay(gateway, timestamp + 7, workBudget)).resolves.toBe('pending');

    const batch = gateway.batch.bind(gateway);
    vi.spyOn(gateway, 'batch').mockImplementationOnce((statements) => {
      sqlite.prepare(`
        INSERT INTO attribute_vote_responses
          (response_id, attribute_id, subject_a_id, subject_b_id, comparison,
           activity_json, session_id, created_at, updated_at, recorded_online)
        VALUES ('late-comparison', ?, ?, ?, 'SIMILAR', '[]', 'staged-replay', ?, ?, 1)
      `).run(attributeId, first.id, second.id, timestamp + 91, timestamp + 91);
      return batch(statements);
    });
    await expect(resumePendingAttributeReplay(gateway, timestamp + 8, workBudget))
      .rejects.toThrow('attribute_replay_history_head_changed');
    expect((await catalog()).generation).toBe(previous.generation);
    await expect(resumePendingAttributeReplay(gateway, timestamp + 9, { ...workBudget, maxSteps: 4 })).resolves.toBe('replay');
    expect(await queryAttributeReplayWork(gateway)).toBeNull();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_replay_work_chunks').get()).toEqual({ count: 0 });
    const published = await catalog();
    const liveScores = scoreRows(harness);
    await runCompleteAttributeReplay(gateway, timestamp + 10);
    expect((await catalog()).values).toEqual(published.values);
    expect(scoreRows(harness)).toEqual(liveScores);
  } finally { close(harness); }
});

test('rejects a late history change before publication and restarts against the newer revision', async () => {
  const { harness, timestamp } = await establishEmptyBaseline();
  try {
    const { gateway, sqlite } = harness;
    const [first, second] = subjects(harness);
    const insert = sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, activity_json, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '[]', 'staged-revision', ?, ?)
    `);
    insert.run('historical-rating', attributeId, first.id, second.id, 2, timestamp + 1, timestamp + 1);
    const catalog = async () => attributeCatalogPayload(await queryAttributeCatalogSnapshot(gateway));
    const previous = await catalog();
    const before = scoreRows(harness);
    await expect(runWeeklyAttributeRebuild(gateway, timestamp + 2, {
      workBudget: { ...workBudget, maxSteps: 1 + previous.attributes.length },
    })).resolves.toBe('pending');
    const work = await queryAttributeReplayWork(gateway);

    const batch = gateway.batch.bind(gateway);
    vi.spyOn(gateway, 'batch').mockImplementationOnce((statements) => {
      sqlite.exec("UPDATE attribute_vote_responses SET rating_a = 4 WHERE response_id = 'historical-rating'");
      insert.run('late-rating', attributeId, first.id, second.id, 8, timestamp + 3, timestamp + 3);
      return batch(statements);
    });
    await expect(resumePendingAttributeReplay(gateway, timestamp + 3, workBudget))
      .rejects.toThrow('attribute_replay_lease_or_revision_changed');
    expect((await catalog()).generation).toBe(previous.generation);
    expect(scoreRows(harness)).toEqual(before);
    expect(await queryAttributeReplayWork(gateway)).toEqual(work);

    await expect(resumePendingAttributeReplay(gateway, timestamp + 4, workBudget)).resolves.toBe('pending');
    expect(await queryAttributeReplayWork(gateway)).toMatchObject({ history_revision: (work?.history_revision ?? 0) + 1, target_rowid: 2 });
    expect((await queryCompletedReplayAttributes(gateway)).size).toBe(0);
    await expect(resumePendingAttributeReplay(gateway, timestamp + 5, { ...workBudget, maxSteps: 64 })).resolves.toBe('replay');
    const published = await catalog();
    expect(published.values.find((row) => row.subjectId === first.id && row.attributeId === attributeId))
      .toMatchObject({ directCount: 2, directAverage: 6 });
  } finally { close(harness); }
});
