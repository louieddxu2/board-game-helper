import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspaceTableViewState, saveWorkspaceTableViewState } from './viewState';

afterEach(() => localStorage.clear());

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
});
