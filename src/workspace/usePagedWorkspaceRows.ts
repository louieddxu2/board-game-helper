import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPendingWorkspaceRow, workspaceRowPageIndex, workspaceRowPageMatchesHead, workspaceRowPageOffset, type WorkspaceTableWindow } from './rowPages';
import type { WorkspaceRow } from './types';
import { SparseWorkspaceRowHeights } from './rowHeights';
export { SparseWorkspaceRowHeights } from './rowHeights';

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
  const entries = useMemo(() => window?.pages.flatMap(page => {
    const index = workspaceRowPageIndex(window.head, page);
    return workspaceRowPageMatchesHead(window.head, index, page)
      ? page.rows.map((row, slot) => [workspaceRowPageOffset(window.head, index) + slot, row] as const) : [];
  }) ?? [], [window]);
  const indexes = useMemo<ReadonlyMap<string, number>>(() => new Map(entries.map(([index, row]) => [row.id, index])), [entries]);
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
