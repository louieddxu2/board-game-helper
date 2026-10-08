import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('view-state'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('keeps legacy fallback independent, gives new keys priority, and masks cleared legacy entries', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(() => {
    const api = window.workspaceStorageFixture;
    const legacyKey = api.viewState.workspaceViewStateStorageKey;
    const legacyRaw = JSON.stringify({ version: 1, tables: {
      'legacy-a': { searchQuery: '舊搜尋', searchOpen: true, headerFilters: {}, scrollLeft: 10, scrollTop: 20 },
      'legacy-b': { searchQuery: '另一張表', searchOpen: false, headerFilters: {}, scrollLeft: 30, scrollTop: 40 },
    } });
    localStorage.setItem(legacyKey, legacyRaw);
    const fallback = api.viewState.loadWorkspaceTableViewState('legacy-a');
    const next = { searchQuery: '新搜尋', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 80 };
    api.viewState.saveWorkspaceTableViewState('legacy-a', next);
    const keys = api.viewState.workspaceTableViewStateKeys('legacy-a');
    const preferred = api.viewState.loadWorkspaceTableViewState('legacy-a');
    api.viewState.clearWorkspaceTableViewState('legacy-a');
    const cleared = api.viewState.loadWorkspaceTableViewState('legacy-a');
    return { fallback, preferred, cleared, legacyRaw, root: localStorage.getItem(legacyKey), settings: localStorage.getItem(keys.settings) };
  });
  expect(result.fallback.searchQuery).toBe('舊搜尋');
  expect(result.fallback.scrollTop).toBe(20);
  expect(result.preferred.searchQuery).toBe('新搜尋');
  expect(result.preferred.scrollTop).toBe(80);
  expect(result.cleared).toEqual({ searchQuery: '', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 0 });
  expect(result.root).toBe(result.legacyRaw);
  expect(result.settings).toContain('"searchQuery":""');
});

test('100 scroll updates with 10,000 included keys touch only one bounded scroll key', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const calls = await page.evaluate(() => {
    const api = window.workspaceStorageFixture;
    const includedKeys = Array.from({ length: 10_000 }, (_, index) => `text:${index}`);
    const large = { searchQuery: '', searchOpen: false, headerFilters: { 'column:tags': { includedKeys, sort: null } }, scrollLeft: 0, scrollTop: 0 };
    api.viewState.saveWorkspaceTableViewState('large-a', large);
    api.viewState.saveWorkspaceTableViewState('large-b', { searchQuery: '第二張表', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 0 });
    api.viewState.loadWorkspaceTableViewState('large-a'); api.viewState.loadWorkspaceTableViewState('large-b');
    const gets: string[] = [], sets: string[] = [];
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { gets.push(key); return originalGet.call(this, key); };
    Storage.prototype.setItem = function (key, value) { sets.push(key); return originalSet.call(this, key, value); };
    try {
      for (let index = 0; index < 100; index++) api.viewState.scheduleWorkspaceTableViewStateSave('large-a', { ...large, scrollLeft: index + 1, scrollTop: (index + 1) * 36 });
      return { gets, sets, scrollKey: api.viewState.workspaceTableViewStateKeys('large-a').scroll, settingsKey: api.viewState.workspaceTableViewStateKeys('large-a').settings, rootKey: api.viewState.workspaceViewStateStorageKey };
    } finally {
      Storage.prototype.getItem = originalGet;
      Storage.prototype.setItem = originalSet;
    }
  });
  expect(calls.gets).toHaveLength(100);
  expect(calls.sets).toHaveLength(100);
  expect(calls.gets.every(key => key === calls.scrollKey)).toBe(true);
  expect(calls.sets.every(key => key === calls.scrollKey)).toBe(true);
  expect(calls.gets).not.toContain(calls.settingsKey);
  expect(calls.gets).not.toContain(calls.rootKey);
});

test('pending settings load immediately and pagehide flushes the latest coalesced value', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(() => {
    const api = window.workspaceStorageFixture;
    const id = 'pending-table';
    const initial = { searchQuery: '初始', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 0 };
    const latest = { searchQuery: '最後一次', searchOpen: true, headerFilters: {}, scrollLeft: 0, scrollTop: 10 };
    api.viewState.saveWorkspaceTableViewState(id, initial);
    api.viewState.loadWorkspaceTableViewState(id);
    api.viewState.scheduleWorkspaceTableViewStateSave(id, { ...initial, searchQuery: '中間' });
    api.viewState.scheduleWorkspaceTableViewStateSave(id, latest);
    api.viewState.queueWorkspaceTableScrollPosition(id, 12, 720);
    const pending = api.viewState.loadWorkspaceTableViewState(id);
    const beforeFlush = localStorage.getItem(api.viewState.workspaceTableViewStateKeys(id).settings);
    window.dispatchEvent(new Event('pagehide'));
    const afterFlush = api.viewState.loadWorkspaceTableViewState(id);
    return { pending, beforeFlush: JSON.parse(beforeFlush!), afterFlush };
  });
  expect(result.pending.searchQuery).toBe('最後一次');
  expect(result.pending.scrollTop).toBe(720);
  expect(result.beforeFlush.searchQuery).toBe('初始');
  expect(result.afterFlush.searchQuery).toBe('最後一次');
  expect(result.afterFlush.scrollTop).toBe(720);
});

test('storage events invalidate cached per-table settings', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(() => {
    const api = window.workspaceStorageFixture;
    const id = 'external-table';
    api.viewState.saveWorkspaceTableViewState(id, { searchQuery: '本機', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 0 });
    api.viewState.loadWorkspaceTableViewState(id);
    const key = api.viewState.workspaceTableViewStateKeys(id).settings;
    const external = JSON.stringify({ searchQuery: '另一個分頁', searchOpen: true, headerFilters: {}, scrollLeft: 0, scrollTop: 0 });
    localStorage.setItem(key, external);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: external }));
    return api.viewState.loadWorkspaceTableViewState(id);
  });
  expect(result.searchQuery).toBe('另一個分頁');
  expect(result.searchOpen).toBe(true);
});
