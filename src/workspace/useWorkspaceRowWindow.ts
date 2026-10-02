import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceRow } from './types';

const ESTIMATED_ROW_HEIGHT = 36;
const OVERSCAN = 6;
const BOTTOM_TOLERANCE = 2;

const rowAtOffset = (offsets: readonly number[], position: number) => {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, offsets.length - 2);
};

interface RowWindowSnapshot {
  rows: readonly WorkspaceRow[];
  offsets: readonly number[];
  scrollTop: number;
  viewportHeight: number;
  scope: string;
  orderKey: string;
  stickToBottom: boolean | undefined;
}

interface ScrollAnchor {
  rowId: string;
  fallbackIndex: number;
  offsetWithinRow: number;
  stickToBottom: boolean;
}

const captureAnchor = (snapshot: RowWindowSnapshot): ScrollAnchor | undefined => {
  if (!snapshot.rows.length) return undefined;
  const index = rowAtOffset(snapshot.offsets, Math.max(0, snapshot.scrollTop));
  return {
    rowId: snapshot.rows[index]?.id ?? '',
    fallbackIndex: index,
    offsetWithinRow: Math.max(0, snapshot.scrollTop - (snapshot.offsets[index] ?? 0)),
    stickToBottom: snapshot.stickToBottom ?? snapshot.scrollTop + snapshot.viewportHeight >= (snapshot.offsets[snapshot.rows.length] ?? 0) - BOTTOM_TOLERANCE,
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
) => {
  const heightsRef = useRef(new Map<string, number>());
  const measurementKeyRef = useRef(measurementKey);
  const scopeRef = useRef(scope);
  const orderKeyRef = useRef(orderKey);
  const snapshotRef = useRef<RowWindowSnapshot | undefined>(undefined);
  const pendingAnchorRef = useRef<ScrollAnchor | undefined>(undefined);
  const pendingMeasurementsRef = useRef(new Map<string, number>());
  const measurementFrameRef = useRef<number | undefined>(undefined);
  const measurementGenerationRef = useRef(0);
  const [revision, setRevision] = useState(0);

  if (measurementKeyRef.current !== measurementKey) {
    const previous = snapshotRef.current;
    if (previous && previous.scope === scope && previous.orderKey === orderKey) {
      pendingAnchorRef.current ??= captureAnchor(previous);
    }
    measurementKeyRef.current = measurementKey;
    heightsRef.current = new Map();
    pendingMeasurementsRef.current.clear();
    measurementGenerationRef.current += 1;
    if (measurementFrameRef.current !== undefined) {
      window.cancelAnimationFrame(measurementFrameRef.current);
      measurementFrameRef.current = undefined;
    }
  }

  if (scopeRef.current !== scope || orderKeyRef.current !== orderKey) {
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

  const rowIndexes = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result[result.length - 1] + (heightsRef.current.get(row.id) ?? ESTIMATED_ROW_HEIGHT));
    return result;
  }, [rows, revision, measurementKey]);
  const virtual = enabled && rows.length > 80;
  const first = virtual ? Math.max(0, rowAtOffset(offsets, Math.max(0, scrollTop)) - OVERSCAN) : 0;
  const last = virtual ? Math.min(rows.length, rowAtOffset(offsets, scrollTop + Math.max(1, viewportHeight)) + OVERSCAN + 1) : rows.length;

  if (pendingAnchorRef.current && previousSnapshot && previousSnapshot.scope === scope && previousSnapshot.orderKey === orderKey && previousSnapshot.scrollTop !== scrollTop) {
    pendingAnchorRef.current = captureAnchor({ rows, offsets, scrollTop, viewportHeight, scope, orderKey, stickToBottom });
  } else if (previousSnapshot && previousSnapshot.rows !== rows && previousSnapshot.scope === scope && previousSnapshot.orderKey === orderKey) {
    pendingAnchorRef.current ??= captureAnchor(previousSnapshot);
  }
  if (!enabled || rows.length <= 80) pendingAnchorRef.current = undefined;
  snapshotRef.current = { rows, offsets, scrollTop, viewportHeight, scope, orderKey, stickToBottom };

  const pendingAnchor = pendingAnchorRef.current;
  const pendingScrollTop = useMemo(() => {
    if (!virtual || !pendingAnchor || !rows.length) return undefined;
    const anchoredIndex = rowIndexes.get(pendingAnchor.rowId);
    const index = anchoredIndex ?? Math.min(pendingAnchor.fallbackIndex, rows.length - 1);
    const totalHeight = offsets[rows.length] ?? 0;
    return Math.max(0, pendingAnchor.stickToBottom
      ? totalHeight - Math.max(0, viewportHeight)
      : (offsets[index] ?? 0) + pendingAnchor.offsetWithinRow);
  }, [offsets, pendingAnchor, rowIndexes, rows.length, viewportHeight, virtual]);

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
          changed = true;
        }
      }
      nextMeasurements.clear();
      if (!changed) return;
      if (snapshot && snapshot.scope === scopeRef.current && snapshot.orderKey === orderKeyRef.current) {
        pendingAnchorRef.current ??= captureAnchor(snapshot);
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
    first,
    last,
    visibleRows: useMemo(() => virtual ? rows.slice(first, last) : rows, [first, last, rows, virtual]),
    topPadding: virtual ? offsets[first] : 0,
    bottomPadding: virtual ? offsets[rows.length] - offsets[last] : 0,
    measureRow,
    offsetForRow: useCallback((id: string) => {
      const index = rowIndexes.get(id);
      return index === undefined ? undefined : offsets[index];
    }, [offsets, rowIndexes]),
    pendingScrollTop,
    pendingStickToBottom: Boolean(pendingAnchor?.stickToBottom),
    consumePendingScrollTop,
  };
};
