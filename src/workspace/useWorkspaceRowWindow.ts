import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceRow } from './types';
import { getWorkspaceRowIndexes } from './rowIndexes';
import { SparseWorkspaceRowHeights } from './rowHeights';

const OVERSCAN = 6;
const BOTTOM_TOLERANCE = 2;

interface RowWindowSnapshot {
  rows: readonly WorkspaceRow[];
  anchor: ScrollAnchor | undefined;
  scrollTop: number;
  scope: string;
  orderKey: string;
}

interface ScrollAnchor {
  rowId: string;
  fallbackIndex: number;
  offsetWithinRow: number;
  stickToBottom: boolean;
}

const captureAnchor = (rows: readonly WorkspaceRow[], heights: SparseWorkspaceRowHeights, scrollTop: number, viewportHeight: number, stickToBottom?: boolean): ScrollAnchor | undefined => {
  if (!rows.length) return undefined;
  const index = heights.indexAt(Math.max(0, scrollTop));
  return {
    rowId: rows[index]?.id ?? '',
    fallbackIndex: index,
    offsetWithinRow: Math.max(0, scrollTop - heights.offset(index)),
    stickToBottom: stickToBottom ?? scrollTop + viewportHeight >= heights.offset(rows.length) - BOTTOM_TOLERANCE,
  };
};

/**
 * Keeps the DOM bounded for long normal-orientation tables while preserving the
 * object the reader was looking at when measured heights change. The owner applies
 * pendingScrollTop in a layout effect, before the updated table is painted.
 */
export const useWorkspaceRowWindow = (
  rows: readonly WorkspaceRow[],
  measurementKey: string,
  scrollTop: number,
  viewportHeight: number,
  enabled: boolean,
  scope = measurementKey,
  orderKey = '',
  stickToBottom?: boolean,
  dynamicWidths = false,
  providedIndexes?: ReadonlyMap<string, number>,
) => {
  const heightsRef = useRef(new Map<string, number>());
  const heightLayoutRef = useRef<{ indexes: ReadonlyMap<string, number>; heights: SparseWorkspaceRowHeights } | undefined>(undefined);
  const measurementKeyRef = useRef(measurementKey);
  const scopeRef = useRef(scope);
  const orderKeyRef = useRef(orderKey);
  const snapshotRef = useRef<RowWindowSnapshot | undefined>(undefined);
  const pendingAnchorRef = useRef<ScrollAnchor | undefined>(undefined);
  const pendingMeasurementsRef = useRef(new Map<string, number>());
  const measurementFrameRef = useRef<number | undefined>(undefined);
  const measurementGenerationRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const rangeRef = useRef<{ rows: readonly WorkspaceRow[]; scope: string; orderKey: string; first: number; last: number } | undefined>(undefined);

  if (measurementKeyRef.current !== measurementKey) {
    const previous = snapshotRef.current;
    if (previous && previous.scope === scope && previous.orderKey === orderKey) {
      pendingAnchorRef.current ??= previous.anchor;
    }
    measurementKeyRef.current = measurementKey;
    // With viewport-based widths, old heights remain estimates until the mounted rows
    // are measured again. Clearing every offscreen estimate makes deep scrolling jump.
    if (!dynamicWidths) { heightsRef.current = new Map(); heightLayoutRef.current = undefined; }
    pendingMeasurementsRef.current.clear();
    measurementGenerationRef.current += 1;
    if (measurementFrameRef.current !== undefined) {
      window.cancelAnimationFrame(measurementFrameRef.current);
      measurementFrameRef.current = undefined;
    }
  }

  if (scopeRef.current !== scope || orderKeyRef.current !== orderKey) {
    if (scopeRef.current !== scope) { heightsRef.current = new Map(); heightLayoutRef.current = undefined; }
    scopeRef.current = scope;
    orderKeyRef.current = orderKey;
    pendingAnchorRef.current = undefined;
    pendingMeasurementsRef.current.clear();
    measurementGenerationRef.current += 1;
    if (measurementFrameRef.current !== undefined) {
      window.cancelAnimationFrame(measurementFrameRef.current);
      measurementFrameRef.current = undefined;
    }
  }

  const previousSnapshot = snapshotRef.current;

  const rowIndexes = useMemo(() => providedIndexes ?? getWorkspaceRowIndexes(rows), [providedIndexes, rows]);
  if (heightLayoutRef.current?.indexes !== rowIndexes || heightLayoutRef.current.heights.count !== rows.length) {
    const heights = new SparseWorkspaceRowHeights(rows.length);
    for (const [id, height] of heightsRef.current) {
      const index = rowIndexes.get(id);
      if (index !== undefined) heights.measure(index, height);
    }
    heightLayoutRef.current = { indexes: rowIndexes, heights };
  }
  const heights = heightLayoutRef.current.heights;
  const virtual = enabled && rows.length > 80;
  const first = virtual ? Math.max(0, heights.indexAt(Math.max(0, scrollTop)) - OVERSCAN) : 0;
  let last = virtual ? Math.min(rows.length, heights.indexAt(scrollTop + Math.max(1, viewportHeight)) + OVERSCAN + 1) : rows.length;
  const previousRange = rangeRef.current;
  // A resize can reduce the number of rows that fit. Keep the already rendered
  // buffer until the leading row changes, so its longest cell cannot oscillate
  // in and out of the very window that determines the width.
  if (dynamicWidths && virtual && previousRange?.rows === rows && previousRange.scope === scope && previousRange.orderKey === orderKey && previousRange.first === first) {
    last = Math.min(rows.length, Math.max(last, previousRange.last));
  }
  rangeRef.current = { rows, scope, orderKey, first, last };

  if (pendingAnchorRef.current && previousSnapshot && previousSnapshot.scope === scope && previousSnapshot.orderKey === orderKey && previousSnapshot.scrollTop !== scrollTop) {
    pendingAnchorRef.current = captureAnchor(rows, heights, scrollTop, viewportHeight, stickToBottom);
  } else if (previousSnapshot && previousSnapshot.rows !== rows && previousSnapshot.scope === scope && previousSnapshot.orderKey === orderKey) {
    pendingAnchorRef.current ??= previousSnapshot.anchor;
  }
  if (!enabled || rows.length <= 80) pendingAnchorRef.current = undefined;
  // Store the anchor's scalar offset before the mutable height index receives measurements.
  snapshotRef.current = { rows, anchor: captureAnchor(rows, heights, scrollTop, viewportHeight, stickToBottom), scrollTop, scope, orderKey };

  const pendingAnchor = pendingAnchorRef.current;
  const pendingScrollTop = useMemo(() => {
    if (!virtual || !pendingAnchor || !rows.length) return undefined;
    const anchoredIndex = rowIndexes.get(pendingAnchor.rowId);
    const index = anchoredIndex ?? Math.min(pendingAnchor.fallbackIndex, rows.length - 1);
    const totalHeight = heights.offset(rows.length);
    return Math.max(0, pendingAnchor.stickToBottom
      ? totalHeight - Math.max(0, viewportHeight)
      : heights.offset(index) + pendingAnchor.offsetWithinRow);
  }, [heights, pendingAnchor, revision, rowIndexes, rows.length, viewportHeight, virtual]);

  const measureRow = useCallback((id: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const pending = pendingMeasurementsRef.current;
    const current = pending.get(id) ?? heightsRef.current.get(id);
    if (current !== undefined && Math.abs(current - height) < 0.5) return;
    pending.set(id, height);
    if (measurementFrameRef.current !== undefined) return;
    const generation = measurementGenerationRef.current;
    measurementFrameRef.current = window.requestAnimationFrame(() => {
      measurementFrameRef.current = undefined;
      if (generation !== measurementGenerationRef.current) return;
      const nextMeasurements = pendingMeasurementsRef.current;
      if (!nextMeasurements.size) return;
      const snapshot = snapshotRef.current;
      let changed = false;
      for (const [rowId, nextHeight] of nextMeasurements) {
        const currentHeight = heightsRef.current.get(rowId);
        if (currentHeight === undefined || Math.abs(currentHeight - nextHeight) >= 0.5) {
          heightsRef.current.set(rowId, nextHeight);
          const layout = heightLayoutRef.current;
          const index = layout?.indexes.get(rowId);
          if (layout && index !== undefined) layout.heights.measure(index, nextHeight);
          changed = true;
        }
      }
      nextMeasurements.clear();
      if (!changed) return;
      if (snapshot && snapshot.scope === scopeRef.current && snapshot.orderKey === orderKeyRef.current) {
        pendingAnchorRef.current ??= snapshot.anchor;
      }
      setRevision((value) => value + 1);
    });
  }, []);

  const consumePendingScrollTop = useCallback(() => {
    pendingAnchorRef.current = undefined;
  }, []);

  useEffect(() => () => {
    if (measurementFrameRef.current !== undefined) window.cancelAnimationFrame(measurementFrameRef.current);
    measurementFrameRef.current = undefined;
    pendingMeasurementsRef.current.clear();
    measurementGenerationRef.current += 1;
  }, []);

  return {
    virtual,
    indexes: rowIndexes,
    first,
    last,
    visibleRows: useMemo(() => virtual ? rows.slice(first, last) : rows, [first, last, rows, virtual]),
    topPadding: virtual ? heights.offset(first) : 0,
    bottomPadding: virtual ? heights.offset(rows.length) - heights.offset(last) : 0,
    measureRow,
    offsetForRow: useCallback((id: string) => {
      const index = rowIndexes.get(id);
      return index === undefined ? undefined : heights.offset(index);
    }, [heights, revision, rowIndexes]),
    pendingScrollTop,
    pendingStickToBottom: Boolean(pendingAnchor?.stickToBottom),
    consumePendingScrollTop,
  };
};
