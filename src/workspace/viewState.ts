import type { HeaderFilterState } from './workspaceShared';

export const workspaceViewStateStorageKey = 'board-game-helper-workspace-view-state';

export interface WorkspaceTableViewState {
  searchQuery: string;
  searchOpen: boolean;
  headerFilters: Record<string, HeaderFilterState>;
  scrollLeft: number;
  scrollTop: number;
}

const emptyViewState = (): WorkspaceTableViewState => ({
  searchQuery: '',
  searchOpen: false,
  headerFilters: {},
  scrollLeft: 0,
  scrollTop: 0,
});

const finiteNonNegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const normalizeFilterState = (value: unknown): HeaderFilterState | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<HeaderFilterState>;
  const includedKeys = candidate.includedKeys === null
    ? null
    : Array.isArray(candidate.includedKeys)
      ? candidate.includedKeys.filter((key): key is string => typeof key === 'string')
      : null;
  const sort = candidate.sort === 'asc' || candidate.sort === 'desc' ? candidate.sort : null;
  const aggregate = candidate.aggregate === 'sum' || candidate.aggregate === 'average' ? candidate.aggregate : undefined;
  return {
    includedKeys,
    sort,
    ...(typeof candidate.query === 'string' ? { query: candidate.query } : {}),
    ...(typeof candidate.min === 'string' ? { min: candidate.min } : {}),
    ...(typeof candidate.max === 'string' ? { max: candidate.max } : {}),
    ...(aggregate ? { aggregate } : {}),
  };
};

const normalizeViewState = (value: unknown): WorkspaceTableViewState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyViewState();
  const candidate = value as Partial<WorkspaceTableViewState>;
  const headerFilters = candidate.headerFilters && typeof candidate.headerFilters === 'object' && !Array.isArray(candidate.headerFilters)
    ? Object.fromEntries(Object.entries(candidate.headerFilters).flatMap(([key, filter]) => {
      const normalized = normalizeFilterState(filter);
      return normalized ? [[key, normalized]] : [];
    }))
    : {};
  return {
    searchQuery: typeof candidate.searchQuery === 'string' ? candidate.searchQuery : '',
    searchOpen: Boolean(candidate.searchOpen),
    headerFilters,
    scrollLeft: finiteNonNegative(candidate.scrollLeft),
    scrollTop: finiteNonNegative(candidate.scrollTop),
  };
};

const readStoredViewStates = (): Record<string, unknown> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(workspaceViewStateStorageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const tables = (parsed as { tables?: unknown }).tables;
    return tables && typeof tables === 'object' && !Array.isArray(tables) ? tables as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

export const loadWorkspaceTableViewState = (tableId: string): WorkspaceTableViewState => normalizeViewState(readStoredViewStates()[tableId]);

export const saveWorkspaceTableViewState = (tableId: string, state: WorkspaceTableViewState) => {
  if (typeof window === 'undefined') return;
  try {
    const tables = readStoredViewStates();
    tables[tableId] = normalizeViewState(state);
    window.localStorage.setItem(workspaceViewStateStorageKey, JSON.stringify({ version: 1, tables }));
  } catch {
    // View preferences are optional and must never interrupt editing.
  }
};

export const clearWorkspaceTableViewState = (tableId: string) => {
  if (typeof window === 'undefined') return;
  try {
    const tables = readStoredViewStates();
    delete tables[tableId];
    window.localStorage.setItem(workspaceViewStateStorageKey, JSON.stringify({ version: 1, tables }));
  } catch {
    // View preferences are optional and must never interrupt editing.
  }
};

export const createEmptyWorkspaceTableViewState = emptyViewState;
