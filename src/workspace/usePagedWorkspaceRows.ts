import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPendingWorkspaceRow, workspaceRowPageMatchesHead, type WorkspaceTableWindow } from './rowPages';
import type { WorkspaceRow } from './types';

export class SparseWorkspaceRowHeights {
  private heights = new Map<number, number>();
  private sums = new Map<number, number>();
  constructor(readonly count: number) {}
  offset(index: number) {
    let delta = 0;
    for (let cursor = index; cursor > 0; cursor -= cursor & -cursor) delta += this.sums.get(cursor) ?? 0;
    return index * 36 + delta;
  }
  measure(index: number, height: number) {
    if (index < 0 || index >= this.count || !Number.isFinite(height) || height <= 0) return false;
    const delta = height - (this.heights.get(index) ?? 36);
    if (Math.abs(delta) < 0.5) return false;
    this.heights.set(index, height);
    for (let cursor = index + 1; cursor <= this.count; cursor += cursor & -cursor) this.sums.set(cursor, (this.sums.get(cursor) ?? 0) + delta);
    return true;
  }
  indexAt(position: number) {
    let low = 0, high = Math.max(0, this.count - 1);
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (this.offset(middle) <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}

/** No complete row array or row index is needed for the display window. */
export const usePagedWorkspaceRows = (window: WorkspaceTableWindow | undefined, measurementKey: string, scrollTop: number, viewportHeight: number, stickToBottom: boolean) => {
  const scope = window ? `${window.head.definition.id}:${window.head.layoutRevision}:${window.head.rowCount}` : '';
  const count = window?.head.rowCount ?? 0;
  const state = useRef({ scope, key: measurementKey, heights: new SparseWorkspaceRowHeights(count) });
  const snapshot = useRef<{ scope: string; top: number; height: number; bottom: boolean } | undefined>(undefined);
  const anchor = useRef<{ index: number; within: number; bottom: boolean } | undefined>(undefined);
  const pending = useRef(new Map<number, number>());
  const frame = useRef<number | undefined>(undefined);
  const [revision, setRevision] = useState(0);
  const range = useRef<{ scope: string; first: number; last: number } | undefined>(undefined);
  if (state.current.scope !== scope || state.current.key !== measurementKey) {
    if (state.current.scope !== scope) {
      state.current = { scope, key: measurementKey, heights: new SparseWorkspaceRowHeights(count) };
      anchor.current = undefined;
    } else state.current.key = measurementKey;
    pending.current.clear();
    if (frame.current !== undefined) globalThis.cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }
  const heights = state.current.heights;
  const entries = useMemo(() => window?.pages.filter(page => workspaceRowPageMatchesHead(window.head, page.index, page))
    .flatMap(page => page.rows.map((row, slot) => [page.index * window.head.pageSize + slot, row] as const)) ?? [], [window]);
  const indexes = useMemo(() => new Map(entries.map(([index, row]) => [row.id, index])), [entries]);
  const rows = useMemo(() => new Map(entries), [entries]);
  const virtual = Boolean(window && count > 80);
  const first = virtual ? Math.max(0, heights.indexAt(Math.max(0, scrollTop)) - 6) : 0;
  let last = virtual ? Math.min(count, heights.indexAt(scrollTop + Math.max(1, viewportHeight)) + 7) : count;
  if (range.current?.scope === scope && range.current.first === first) last = Math.min(count, Math.max(last, range.current.last));
  range.current = { scope, first, last };
  const previous = snapshot.current;
  if (anchor.current && previous?.scope === scope && previous.top !== scrollTop) {
    const index = heights.indexAt(Math.max(0, scrollTop));
    anchor.current = { index, within: scrollTop - heights.offset(index), bottom: stickToBottom };
  }
  snapshot.current = { scope, top: scrollTop, height: viewportHeight, bottom: stickToBottom };
  const visibleRows = useMemo(() => Array.from({ length: Math.max(0, last - first) }, (_, offset): WorkspaceRow => rows.get(first + offset) ?? createPendingWorkspaceRow(first + offset)), [first, last, rows]);
  const measureRow = useCallback((id: string, height: number) => {
    if (state.current.scope !== scope || state.current.key !== measurementKey) return;
    const index = indexes.get(id);
    if (index === undefined || !Number.isFinite(height) || height <= 0) return;
    pending.current.set(index, height);
    if (frame.current !== undefined) return;
    frame.current = globalThis.requestAnimationFrame(() => {
      frame.current = undefined;
      const current = snapshot.current;
      if (state.current.scope !== scope || !current) return;
      const index = heights.indexAt(Math.max(0, current.top));
      const nextAnchor = { index, within: current.top - heights.offset(index), bottom: current.bottom };
      let changed = false;
      for (const [index, height] of pending.current) changed = heights.measure(index, height) || changed;
      pending.current.clear();
      if (!changed) return;
      anchor.current ??= nextAnchor;
      setRevision(value => value + 1);
    });
  }, [heights, indexes, measurementKey, scope]);
  useEffect(() => () => {
    if (frame.current !== undefined) globalThis.cancelAnimationFrame(frame.current);
    frame.current = undefined;
    pending.current.clear();
  }, []);
  void revision;
  return {
    virtual, first, last, visibleRows, indexes,
    topPadding: virtual ? heights.offset(first) : 0,
    bottomPadding: virtual ? heights.offset(count) - heights.offset(last) : 0,
    measureRow,
    offsetForRow: useCallback((id: string) => { const index = indexes.get(id); return index === undefined ? undefined : heights.offset(index); }, [heights, indexes]),
    pendingScrollTop: anchor.current ? Math.max(0, anchor.current.bottom ? heights.offset(count) - viewportHeight : heights.offset(anchor.current.index) + anchor.current.within) : undefined,
    pendingStickToBottom: Boolean(anchor.current?.bottom),
    consumePendingScrollTop: useCallback(() => { anchor.current = undefined; }, []),
  };
};
