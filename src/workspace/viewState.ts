import type { HeaderFilterState } from './workspaceShared';
import { afterWorkspacePaint } from './backgroundWork';

export const workspaceViewStateStorageKey = 'board-game-helper-workspace-view-state';
export const workspaceTableViewStateKeys = (tableId: string) => ({
  settings: `${workspaceViewStateStorageKey}:settings:${encodeURIComponent(tableId)}`,
  scroll: `${workspaceViewStateStorageKey}:scroll:${encodeURIComponent(tableId)}`,
});

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
  const datePrecision = candidate.datePrecision === 'year' || candidate.datePrecision === 'month' || candidate.datePrecision === 'day' ? candidate.datePrecision : undefined;
  return {
    includedKeys,
    sort,
    ...(typeof candidate.query === 'string' ? { query: candidate.query } : {}),
    ...(typeof candidate.min === 'string' ? { min: candidate.min } : {}),
    ...(typeof candidate.max === 'string' ? { max: candidate.max } : {}),
    ...(datePrecision ? { datePrecision } : {}),
    ...(aggregate ? { aggregate } : {}),
  };
};

const normalizeViewState = (value: unknown): WorkspaceTableViewState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyViewState();
  const candidate = value as Partial<WorkspaceTableViewState>;
  const headerFilters = candidate.headerFilters && typeof candidate.headerFilters === 'object' && !Array.isArray(candidate.headerFilters)
    ? Object.fromEntries(Object.entries(candidate.headerFilters).flatMap(([key, filter]) => {
      if (key.startsWith('row:')) return [];
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

let legacyViewStates: { raw: string; tables: Record<string, unknown> } | undefined;
const readStoredViewStates = (): Record<string, unknown> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(workspaceViewStateStorageKey);
    if (!raw) return {};
    if (legacyViewStates?.raw === raw) return legacyViewStates.tables;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const tables = (parsed as { tables?: unknown }).tables;
    const result = tables && typeof tables === 'object' && !Array.isArray(tables) ? tables as Record<string, unknown> : {};
    legacyViewStates = { raw, tables: result };
    return result;
  } catch {
    return {};
  }
};

type Settings = Pick<WorkspaceTableViewState, 'searchQuery' | 'searchOpen' | 'headerFilters'>;
const sameSettings = (left: Settings | undefined, right: Settings) => left?.searchQuery === right.searchQuery
  && left.searchOpen === right.searchOpen && left.headerFilters === right.headerFilters;
const settingsOf = ({ searchQuery, searchOpen, headerFilters }: Settings): Settings => ({ searchQuery, searchOpen, headerFilters });
const savedSettings = new Map<string, { raw: string | null; state: Settings; source: Settings }>();
const pendingSettings = new Map<string, WorkspaceTableViewState>();
type ScrollPosition = Pick<WorkspaceTableViewState, 'scrollLeft' | 'scrollTop'>;
const pendingScroll = new Map<string, ScrollPosition>();
const latestScroll = new Map<string, ScrollPosition>();
const scheduled = new Map<string, () => void>();
const readJson = (raw: string | null): unknown => { try { return raw === null ? undefined : JSON.parse(raw); } catch { return undefined; } };

export const loadWorkspaceTableViewState = (tableId: string): WorkspaceTableViewState => {
  const pending = pendingSettings.get(tableId);
  if (pending) return { ...pending, ...latestScroll.get(tableId) };
  if (typeof window === 'undefined') return emptyViewState();
  try {
    const keys = workspaceTableViewStateKeys(tableId);
    const raw = window.localStorage.getItem(keys.settings);
    const scroll = pendingScroll.get(tableId) ?? readJson(window.localStorage.getItem(keys.scroll));
    const cached = savedSettings.get(tableId);
    const state = raw !== null && cached?.raw === raw ? { ...emptyViewState(), ...cached.state }
      : normalizeViewState(raw === null ? readStoredViewStates()[tableId] : readJson(raw));
    savedSettings.set(tableId, { raw, state: settingsOf(state), source: settingsOf(state) });
    return scroll && typeof scroll === 'object' && !Array.isArray(scroll)
      ? { ...state, scrollLeft: finiteNonNegative((scroll as WorkspaceTableViewState).scrollLeft), scrollTop: finiteNonNegative((scroll as WorkspaceTableViewState).scrollTop) } : state;
  } catch { return emptyViewState(); }
};

/** Scroll updates never copy or serialize filters, including large includedKeys arrays. */
const saveScroll = (tableId: string, state: ScrollPosition) => {
  const key = workspaceTableViewStateKeys(tableId).scroll;
  const position = { scrollLeft: finiteNonNegative(state.scrollLeft), scrollTop: finiteNonNegative(state.scrollTop) };
  latestScroll.set(tableId, position);
  const raw = JSON.stringify(position);
  if (window.localStorage.getItem(key) !== raw) window.localStorage.setItem(key, raw);
};
const writeSettings = (tableId: string, state: WorkspaceTableViewState) => {
  const key = workspaceTableViewStateKeys(tableId).settings;
  const cached = savedSettings.get(tableId);
  const current = window.localStorage.getItem(key);
  if (current !== null && cached?.raw === current && sameSettings(cached.source, state)) return;
  const normalized = settingsOf(normalizeViewState(state));
  const raw = JSON.stringify(normalized);
  if (current !== raw) window.localStorage.setItem(key, raw);
  savedSettings.set(tableId, { raw, state: normalized, source: settingsOf(state) });
};
const cancelScheduled = (tableId: string) => { scheduled.get(tableId)?.(); scheduled.delete(tableId); };

export const saveWorkspaceTableViewState = (tableId: string, state: WorkspaceTableViewState) => {
  if (typeof window === 'undefined') return;
  cancelScheduled(tableId);
  pendingSettings.delete(tableId);
  pendingScroll.delete(tableId);
  try {
    saveScroll(tableId, state);
    writeSettings(tableId, state);
  } catch {
    // View preferences are optional and must never interrupt editing.
  }
};

export const flushWorkspaceTableViewState = (tableId?: string) => {
  flushWorkspaceTableScrollPosition(tableId);
  for (const id of tableId ? [tableId] : [...pendingSettings.keys()]) {
    const state = pendingSettings.get(id);
    if (!state) continue;
    cancelScheduled(id);
    pendingSettings.delete(id);
    try { writeSettings(id, state); } catch { /* Optional UI preferences. */ }
  }
};

let listening = false;
const listenForViewStateLifecycle = () => {
  if (!listening) {
    window.addEventListener('pagehide', () => flushWorkspaceTableViewState());
    window.addEventListener('storage', event => {
      if (event.key === null || event.key.startsWith(workspaceViewStateStorageKey)) savedSettings.clear();
    });
    listening = true;
  }
};
/** Raw scroll events retain two numbers in memory; the viewport's debounce flushes them. */
export const queueWorkspaceTableScrollPosition = (tableId: string, scrollLeft: number, scrollTop: number) => {
  if (typeof window === 'undefined') return;
  listenForViewStateLifecycle();
  const position = { scrollLeft: finiteNonNegative(scrollLeft), scrollTop: finiteNonNegative(scrollTop) };
  pendingScroll.set(tableId, position);
  latestScroll.set(tableId, position);
};
export const flushWorkspaceTableScrollPosition = (tableId?: string) => {
  for (const id of tableId ? [tableId] : [...pendingScroll.keys()]) {
    const position = pendingScroll.get(id);
    if (!position) continue;
    pendingScroll.delete(id);
    try { saveScroll(id, position); } catch { /* Optional UI preferences. */ }
  }
};
/** The UI's scroll debounce already ran; settings wait for a pause and an idle slot. */
export const scheduleWorkspaceTableViewStateSave = (tableId: string, state: WorkspaceTableViewState) => {
  if (typeof window === 'undefined') return;
  listenForViewStateLifecycle();
  try { if (!pendingScroll.has(tableId)) saveScroll(tableId, state); } catch { /* Optional UI preferences. */ }
  cancelScheduled(tableId);
  const cached = savedSettings.get(tableId);
  if (cached?.raw !== null && sameSettings(cached?.source, state)) { pendingSettings.delete(tableId); return; }
  pendingSettings.set(tableId, state);
  let cancelIdle: (() => void) | undefined;
  const timer = setTimeout(() => {
    cancelIdle = afterWorkspacePaint(() => flushWorkspaceTableViewState(tableId), true);
  }, 300);
  scheduled.set(tableId, () => { clearTimeout(timer); cancelIdle?.(); });
};

export const clearWorkspaceTableViewState = (tableId: string) => {
  // An empty per-table state masks its legacy entry without rewriting other tables.
  saveWorkspaceTableViewState(tableId, emptyViewState());
};

export const createEmptyWorkspaceTableViewState = emptyViewState;
