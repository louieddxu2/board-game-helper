import type { RefObject } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceColumn, WorkspaceTable } from './types';
import { measureVisibleColumnWidths } from './visibleColumnWidths';
import { workspaceCellPadding, workspaceMinColumnWidth } from './workspaceShared';
import { createWorkspaceTextWidthCache } from './workspaceTextWidthCache';

interface WorkspaceColumnSizingOptions {
  table: WorkspaceTable | undefined;
  rowHeader: WorkspaceColumn | undefined;
  displayedColumns: WorkspaceColumn[];
  viewportRef: RefObject<HTMLDivElement | null>;
}

export const useWorkspaceColumnSizing = ({ table, rowHeader, displayedColumns, viewportRef }: WorkspaceColumnSizingOptions) => {
  const [viewportWidth, setViewportWidth] = useState(0);

  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);

  const textWidthCache = useMemo(() => createWorkspaceTextWidthCache(), []);

  const [mountedTextWidths, setMountedTextWidths] = useState<{ tableId: string; widths: number[] }>();

  const columnHeaderWidths = useMemo(() => table && rowHeader
    ? measureVisibleColumnWidths([], rowHeader, displayedColumns, textWidthCache) : [], [table?.id, rowHeader, displayedColumns, textWidthCache]);

  const columnTextWidths = mountedTextWidths && mountedTextWidths.tableId === table?.id && mountedTextWidths.widths.length === columnHeaderWidths.length ? mountedTextWidths.widths : columnHeaderWidths;

  const [localMinTextScale, setLocalMinTextScale] = useState(0.35);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      setViewportWidth(viewport.clientWidth);
      setViewportHeight(viewport.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [table]);

  useEffect(() => {
    if (!columnTextWidths.length || !viewportWidth) return;
    const widthAt = (scale: number) => columnTextWidths.reduce((total, width) => total + Math.max(workspaceMinColumnWidth, width * scale + workspaceCellPadding), 0);
    if (widthAt(1) <= viewportWidth) { setLocalMinTextScale(1); return; }
    if (widthAt(0.1) >= viewportWidth) { setLocalMinTextScale(0.1); return; }
    let low = 0.1;
    let high = 1;
    for (let index = 0; index < 20; index += 1) {
      const middle = (low + high) / 2;
      if (widthAt(middle) <= viewportWidth) low = middle; else high = middle;
    }
    setLocalMinTextScale(low);
  }, [columnTextWidths, viewportWidth]);

  return { localMinTextScale, viewportWidth, columnTextWidths, viewportHeight, textWidthCache, setMountedTextWidths };
};
