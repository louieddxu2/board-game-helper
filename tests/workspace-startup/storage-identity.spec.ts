import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('identity'); });
test.afterAll(async () => site.close());

test('backup identity survives saves, history and reload, but changes when only IndexedDB is cleared', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const initial = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(260, 2);
    api.instrument(); api.reads = []; api.writes = [];
    const identity = await api.db.loadWorkspaceStorageIdentity();
    const reads = [...api.reads], writes = [...api.writes];
    api.writes = [];
    const repeated = await api.db.loadWorkspaceStorageIdentity();
    const repeatedWrites = [...api.writes];
    await api.edit(0, '儲存後的內容');
    await api.db.saveWorkspaceHistory(api.history.createEmptyWorkspaceTableHistory(api.data.tables[0].id));
    const afterSave = await api.db.loadWorkspaceStorageIdentity();
    localStorage.setItem('board-game-helper-google-drive-backup', JSON.stringify({ storageIdentity: identity, fileId: 'last-good' }));
    localStorage.setItem('board-game-helper-google-drive-auto-backup', 'true');
    return { identity, repeated, afterSave, reads, writes, repeatedWrites };
  });
  expect(initial.identity).toBeTruthy();
  expect(initial.repeated).toBe(initial.identity);
  expect(initial.afterSave).toBe(initial.identity);
  expect(initial.reads.map(read => [read.store, read.method, read.key])).toEqual([['meta', 'get', 'storage']]);
  expect(initial.writes.map(write => [write.store, write.method, write.key])).toEqual([['meta', 'put', 'storage']]);
  expect(initial.repeatedWrites).toEqual([]);

  await page.reload();
  expect(await page.evaluate(async () => {
    await window.workspaceStorageFixture.db.loadWorkspaceInitial({ paged: true });
    return window.workspaceStorageFixture.db.loadWorkspaceStorageIdentity();
  })).toBe(initial.identity);

  const session = await page.context().newCDPSession(page);
  await session.send('Storage.clearDataForOrigin', { origin: site.origin, storageTypes: 'indexeddb' });
  await session.detach();
  await page.reload();
  const recreated = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const loaded = await api.db.loadWorkspaceInitial({ paged: true });
    return { identity: await api.db.loadWorkspaceStorageIdentity(), tables: loaded.data.tables.length,
      record: JSON.parse(localStorage.getItem('board-game-helper-google-drive-backup')!),
      automatic: localStorage.getItem('board-game-helper-google-drive-auto-backup') };
  });
  expect(recreated.tables).toBe(0);
  expect(recreated.identity).not.toBe(initial.identity);
  expect(recreated.record).toEqual({ storageIdentity: initial.identity, fileId: 'last-good' });
  expect(recreated.automatic).toBe('true');
});
