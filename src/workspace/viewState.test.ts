import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearWorkspaceTableViewState,
  flushWorkspaceTableScrollPosition,
  flushWorkspaceTableViewState,
  loadWorkspaceTableViewState,
  queueWorkspaceTableScrollPosition,
  saveWorkspaceTableViewState,
  scheduleWorkspaceTableViewStateSave,
  workspaceTableViewStateKeys,
  workspaceViewStateStorageKey,
} from './viewState';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const state = (overrides: Partial<ReturnType<typeof loadWorkspaceTableViewState>> = {}) => ({
  searchQuery: '', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 0, ...overrides,
});

describe('workspace table view state', () => {
  it('keeps search, filters, and scroll positions independent per table', () => {
    saveWorkspaceTableViewState('table-a', {
      searchQuery: '收藏',
      searchOpen: true,
      headerFilters: { 'column:name': { includedKeys: ['text:收藏'], sort: 'asc' } },
      scrollLeft: 120,
      scrollTop: 340,
    });

    expect(loadWorkspaceTableViewState('table-a')).toEqual({
      searchQuery: '收藏',
      searchOpen: true,
      headerFilters: { 'column:name': { includedKeys: ['text:收藏'], sort: 'asc' } },
      scrollLeft: 120,
      scrollTop: 340,
    });
    expect(loadWorkspaceTableViewState('table-b')).toEqual({
      searchQuery: '', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 0,
    });
  });

  it('ignores damaged values instead of affecting the editor', () => {
    localStorage.setItem('board-game-helper-workspace-view-state', JSON.stringify({
      version: 1,
      tables: { broken: { searchQuery: 42, headerFilters: { bad: { sort: 'sideways' } }, scrollLeft: -10, scrollTop: 'later' } },
    }));

    expect(loadWorkspaceTableViewState('broken')).toEqual({
      searchQuery: '', searchOpen: false, headerFilters: { bad: { includedKeys: null, sort: null } }, scrollLeft: 0, scrollTop: 0,
    });
  });

  it('drops legacy row-axis filters while preserving column filters', () => {
    localStorage.setItem('board-game-helper-workspace-view-state', JSON.stringify({
      version: 1,
      tables: { table: { headerFilters: {
        'row:row-0': { includedKeys: [], sort: 'asc' },
        'column:column-0': { includedKeys: ['text:保留'], sort: 'desc' },
      } } },
    }));

    expect(loadWorkspaceTableViewState('table').headerFilters).toEqual({
      'column:column-0': { includedKeys: ['text:保留'], sort: 'desc' },
    });
  });

  it('restores the chosen date filter precision', () => {
    saveWorkspaceTableViewState('dates', {
      searchQuery: '', searchOpen: true,
      headerFilters: { 'column:date': { includedKeys: null, sort: null, min: '2024-01-01', max: '2025-12-31', datePrecision: 'year' } },
      scrollLeft: 0, scrollTop: 0,
    });

    expect(loadWorkspaceTableViewState('dates').headerFilters['column:date'].datePrecision).toBe('year');
  });

  it('reads legacy table entries independently, prefers new keys, and clears by masking legacy state', () => {
    const legacyRaw = JSON.stringify({ version: 1, tables: {
      'legacy-a': { searchQuery: '舊搜尋', searchOpen: true, headerFilters: {}, scrollLeft: 10, scrollTop: 20 },
      'legacy-b': { searchQuery: '另一張表', searchOpen: false, headerFilters: {}, scrollLeft: 30, scrollTop: 40 },
    } });
    localStorage.setItem(workspaceViewStateStorageKey, legacyRaw);

    expect(loadWorkspaceTableViewState('legacy-a')).toEqual({ searchQuery: '舊搜尋', searchOpen: true, headerFilters: {}, scrollLeft: 10, scrollTop: 20 });
    saveWorkspaceTableViewState('legacy-a', state({ searchQuery: '新搜尋', scrollTop: 80 }));
    const keys = workspaceTableViewStateKeys('legacy-a');
    expect(localStorage.getItem(workspaceViewStateStorageKey)).toBe(legacyRaw);
    expect(loadWorkspaceTableViewState('legacy-a').searchQuery).toBe('新搜尋');
    expect(loadWorkspaceTableViewState('legacy-a').scrollTop).toBe(80);
    expect(loadWorkspaceTableViewState('legacy-b').searchQuery).toBe('另一張表');

    clearWorkspaceTableViewState('legacy-a');
    expect(loadWorkspaceTableViewState('legacy-a')).toEqual(state());
    expect(localStorage.getItem(keys.settings)).toContain('"searchQuery":""');
    expect(localStorage.getItem(workspaceViewStateStorageKey)).toBe(legacyRaw);
  });

  it('writes only bounded per-table scroll keys during repeated 10,000-option scrolling', () => {
    const includedKeys = Array.from({ length: 10_000 }, (_, index) => `text:${index}`);
    const large = state({ headerFilters: { 'column:tags': { includedKeys, sort: null } } });
    saveWorkspaceTableViewState('large-a', large);
    saveWorkspaceTableViewState('large-b', state({ searchQuery: '其他表' }));
    loadWorkspaceTableViewState('large-a'); loadWorkspaceTableViewState('large-b');
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');

    for (let index = 0; index < 100; index++) scheduleWorkspaceTableViewStateSave('large-a', { ...large, scrollLeft: index + 1, scrollTop: (index + 1) * 36 });

    const scrollKey = workspaceTableViewStateKeys('large-a').scroll;
    expect(get.mock.calls.map(([key]) => key)).toEqual(Array(100).fill(scrollKey));
    expect(set.mock.calls.map(([key]) => key)).toEqual(Array(100).fill(scrollKey));
    expect(loadWorkspaceTableViewState('large-a').headerFilters['column:tags'].includedKeys).toHaveLength(10_000);
    flushWorkspaceTableViewState('large-a');
  });

  it('keeps one hundred raw scroll positions in memory without storage I/O', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    for (let index = 0; index < 100; index++) queueWorkspaceTableScrollPosition('raw-scroll', index + 1, (index + 1) * 24);

    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(loadWorkspaceTableViewState('raw-scroll').scrollTop).toBe(2_400);
    get.mockClear();
    set.mockClear();

    flushWorkspaceTableScrollPosition('raw-scroll');
    const key = workspaceTableViewStateKeys('raw-scroll').scroll;
    expect(get.mock.calls.map(([name]) => name)).toEqual([key]);
    expect(set.mock.calls.map(([name]) => name)).toEqual([key]);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ scrollLeft: 100, scrollTop: 2_400 });
  });

  it('flushes the latest raw position on pagehide without letting pending settings restore an old position', () => {
    const id = 'raw-pagehide';
    const initial = state({ searchQuery: '初始', scrollLeft: 1, scrollTop: 2 });
    saveWorkspaceTableViewState(id, initial);
    loadWorkspaceTableViewState(id);
    scheduleWorkspaceTableViewStateSave(id, { ...initial, searchQuery: '編輯中', scrollLeft: 10, scrollTop: 20 });
    queueWorkspaceTableScrollPosition(id, 90, 1_080);

    window.dispatchEvent(new Event('pagehide'));

    const keys = workspaceTableViewStateKeys(id);
    expect(JSON.parse(localStorage.getItem(keys.scroll)!)).toEqual({ scrollLeft: 90, scrollTop: 1_080 });
    expect(loadWorkspaceTableViewState(id)).toMatchObject({ searchQuery: '編輯中', scrollLeft: 90, scrollTop: 1_080 });
    expect(JSON.parse(localStorage.getItem(keys.settings)!)).toEqual({ searchQuery: '編輯中', searchOpen: false, headerFilters: {} });
  });

  it('returns pending settings immediately and coalesces writes until one idle slot', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    const idles: IdleRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => { idles.push(callback); return idles.length; });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const initial = state({ searchQuery: '初始' });
    saveWorkspaceTableViewState('pending', initial);
    loadWorkspaceTableViewState('pending');
    const first = state({ searchQuery: '第 1 次' });
    const last = state({ searchQuery: '最後一次', searchOpen: true });
    scheduleWorkspaceTableViewStateSave('pending', first);
    scheduleWorkspaceTableViewStateSave('pending', last);

    expect(loadWorkspaceTableViewState('pending')).toEqual(last);
    expect(JSON.parse(localStorage.getItem(workspaceTableViewStateKeys('pending').settings)!).searchQuery).toBe('初始');
    vi.advanceTimersByTime(300);
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    vi.advanceTimersByTime(0);
    expect(idles).toHaveLength(1);
    idles.shift()!({ didTimeout: false, timeRemaining: () => 10 });
    expect(JSON.parse(localStorage.getItem(workspaceTableViewStateKeys('pending').settings)!).searchQuery).toBe('最後一次');
    expect(loadWorkspaceTableViewState('pending')).toEqual(last);
  });

  it('flushes pending settings on pagehide and ignores storage failures', () => {
    const initial = state({ searchQuery: '原始' });
    saveWorkspaceTableViewState('flush', initial);
    loadWorkspaceTableViewState('flush');
    const next = state({ searchQuery: '離開前' });
    scheduleWorkspaceTableViewStateSave('flush', next);
    window.dispatchEvent(new Event('pagehide'));
    expect(loadWorkspaceTableViewState('flush')).toEqual(next);

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
    expect(() => saveWorkspaceTableViewState('broken-save', next)).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });

  it('invalidates cached settings when another tab changes a view key', () => {
    saveWorkspaceTableViewState('external', state({ searchQuery: '本機' }));
    expect(loadWorkspaceTableViewState('external').searchQuery).toBe('本機');
    const keys = workspaceTableViewStateKeys('external');
    localStorage.setItem(keys.settings, JSON.stringify(state({ searchQuery: '另一個分頁' })));
    window.dispatchEvent(new StorageEvent('storage', { key: keys.settings, newValue: localStorage.getItem(keys.settings) }));
    expect(loadWorkspaceTableViewState('external').searchQuery).toBe('另一個分頁');
  });
});
