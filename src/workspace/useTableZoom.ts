import { useEffect, useRef, useState } from 'react';
import type { WorkspaceData, WorkspaceTable } from './types';
import { updateTable, workspaceMaxTextScale } from './workspaceShared';

interface UseTableZoomProps {
  table: WorkspaceTable | undefined;
  data: WorkspaceData | undefined;
  commit: (next: WorkspaceData) => void;
  workspacePageRef: React.RefObject<HTMLElement | null>;
  minTextScale: number;
}

export function useTableZoom({ table, data, commit, workspacePageRef, minTextScale }: UseTableZoomProps) {
  const [textScale, setTextScale] = useState(1);
  const textScaleRef = useRef(1);
  const applyTextScaleRef = useRef<((scale: number, persist?: boolean) => void) | undefined>(undefined);
  const pendingScaleSave = useRef<{ tableId: string; scale: number } | undefined>(undefined);
  const scaleSaveTimer = useRef<number | undefined>(undefined);

  const dataRef = useRef<WorkspaceData | undefined>(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    return () => {
      if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    const nextScale = table?.textScale ?? 1;
    textScaleRef.current = nextScale;
    setTextScale(nextScale);
  }, [table?.id, table?.textScale]);

  useEffect(() => {
    setTextScale((current) => {
      const next = Math.max(minTextScale, Math.min(workspaceMaxTextScale, current));
      textScaleRef.current = next;
      return next;
    });
  }, [minTextScale]);

  const persistTextScale = (scale: number) => {
    const pending = pendingScaleSave.current;
    const currentData = dataRef.current;
    const tableId = pending?.tableId ?? table?.id;
    pendingScaleSave.current = undefined;
    if (!currentData || !tableId) return;
    const currentTable = currentData.tables.find((item) => item.id === tableId);
    if (!currentTable || Math.abs((currentTable.textScale ?? 1) - scale) < 0.001) return;
    commit(updateTable(currentData, tableId, (current) => ({ ...current, textScale: scale, updatedAt: Date.now() })));
  };

  const scheduleTextScaleSave = (scale: number) => {
    if (!table) return;
    pendingScaleSave.current = { tableId: table.id, scale };
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current);
    scaleSaveTimer.current = window.setTimeout(() => {
      scaleSaveTimer.current = undefined;
      persistTextScale(pendingScaleSave.current?.scale ?? scale);
    }, 180);
  };

  const applyTextScale = (scale: number, persist = true) => {
    const nextScale = Math.max(minTextScale, Math.min(workspaceMaxTextScale, scale));
    textScaleRef.current = nextScale;
    setTextScale(nextScale);
    if (persist) scheduleTextScaleSave(nextScale);
  };
  applyTextScaleRef.current = applyTextScale;

  const flushPendingTextScale = () => {
    if (scaleSaveTimer.current) window.clearTimeout(scaleSaveTimer.current);
    scaleSaveTimer.current = undefined;
    const pending = pendingScaleSave.current;
    if (pending) persistTextScale(pending.scale);
  };

  useEffect(() => {
    const isInsideWorkspace = (target: EventTarget | null) => target instanceof Node && Boolean(workspacePageRef.current?.contains(target));
    const isInsideDialog = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.workspace-dialog'));
    const onWheelCapture = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !isInsideWorkspace(event.target)) return;
      event.preventDefault();
      if (isInsideDialog(event.target)) return;
      applyTextScaleRef.current?.(textScaleRef.current - event.deltaY * 0.002);
    };
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !['+', '=', '-', '_', '0'].includes(event.key) || !isInsideWorkspace(event.target)) return;
      event.preventDefault();
      if (isInsideDialog(event.target)) return;
      if (event.key === '0') {
        applyTextScaleRef.current?.(1);
        return;
      }
      applyTextScaleRef.current?.(textScaleRef.current + (event.key === '-' || event.key === '_' ? -0.1 : 0.1));
    };
    window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => {
      window.removeEventListener('wheel', onWheelCapture, true);
      window.removeEventListener('keydown', onKeyDownCapture, true);
    };
  }, [workspacePageRef]);

  return {
    textScale,
    setTextScale,
    textScaleRef,
    applyTextScale,
    pendingScaleSave,
    flushPendingTextScale,
  };
}
