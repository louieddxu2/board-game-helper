import { useCallback, useMemo, useRef, useState } from 'react';
import type { WorkspaceRow } from './types';

const ESTIMATED_ROW_HEIGHT = 36;
const OVERSCAN = 6;

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

export const useWorkspaceRowWindow = (
  rows: readonly WorkspaceRow[],
  measurementKey: string,
  scrollTop: number,
  viewportHeight: number,
  enabled: boolean,
) => {
  const heightsRef = useRef(new Map<string, number>());
  const keyRef = useRef(measurementKey);
  const [revision, setRevision] = useState(0);
  if (keyRef.current !== measurementKey) {
    keyRef.current = measurementKey;
    heightsRef.current = new Map();
  }
  const offsets = useMemo(() => {
    const result = [0];
    for (const row of rows) result.push(result[result.length - 1] + (heightsRef.current.get(row.id) ?? ESTIMATED_ROW_HEIGHT));
    return result;
  }, [rows, revision, measurementKey]);
  const virtual = enabled && rows.length > 80;
  const first = virtual ? Math.max(0, rowAtOffset(offsets, Math.max(0, scrollTop)) - OVERSCAN) : 0;
  const last = virtual ? Math.min(rows.length, rowAtOffset(offsets, scrollTop + Math.max(1, viewportHeight)) + OVERSCAN + 1) : rows.length;
  const measureRow = useCallback((id: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const current = heightsRef.current.get(id);
    if (current !== undefined && Math.abs(current - height) < 0.5) return;
    heightsRef.current.set(id, height);
    setRevision((value) => value + 1);
  }, []);
  const offsetForRow = useCallback((id: string) => {
    const index = rows.findIndex((row) => row.id === id);
    return index < 0 ? undefined : offsets[index];
  }, [offsets, rows]);
  return {
    virtual,
    first,
    last,
    visibleRows: useMemo(() => virtual ? rows.slice(first, last) : rows, [first, last, rows, virtual]),
    topPadding: virtual ? offsets[first] : 0,
    bottomPadding: virtual ? offsets[rows.length] - offsets[last] : 0,
    measureRow,
    offsetForRow,
  };
};
