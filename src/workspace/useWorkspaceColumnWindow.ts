import { useCallback, useMemo } from 'react';
import type { WorkspaceRow } from './types';

const OVERSCAN = 3;

const columnAtOffset = (offsets: readonly number[], position: number) => {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, offsets.length - 2);
};

export const useWorkspaceColumnWindow = (
  rows: readonly WorkspaceRow[],
  widths: readonly number[],
  scrollLeft: number,
  viewportWidth: number,
  enabled: boolean,
) => {
  const rowIndexes = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);
  const offsets = useMemo(() => {
    const result = [0];
    for (let index = 0; index < rows.length; index += 1) result.push(result[result.length - 1] + (widths[index + 1] ?? 48));
    return result;
  }, [rows, widths]);
  const virtual = enabled && rows.length > 80;
  const first = virtual ? Math.max(0, columnAtOffset(offsets, Math.max(0, scrollLeft - (widths[0] ?? 0))) - OVERSCAN) : 0;
  const last = virtual ? Math.min(rows.length, columnAtOffset(offsets, scrollLeft + Math.max(1, viewportWidth) - (widths[0] ?? 0)) + OVERSCAN + 1) : rows.length;
  return {
    virtual,
    first,
    last,
    visibleRows: useMemo(() => virtual ? rows.slice(first, last) : rows, [first, last, rows, virtual]),
    visibleWidths: useMemo(() => virtual ? widths.slice(first + 1, last + 1) : widths.slice(1), [first, last, virtual, widths]),
    leftPadding: virtual ? offsets[first] : 0,
    rightPadding: virtual ? offsets[rows.length] - offsets[last] : 0,
    offsetForRow: useCallback((id: string) => {
      const index = rowIndexes.get(id);
      return index === undefined ? undefined : (widths[0] ?? 0) + offsets[index];
    }, [offsets, rowIndexes, widths]),
  };
};
