import { useEffect, type RefObject } from 'react';
import { afterWorkspacePaint } from './backgroundWork';
import { maintainWorkspaceRowPages } from './db';
import type { WorkspaceData } from './types';

/** Run once after this table becomes complete; ordinary edits do not reschedule it. */
export const useWorkspaceRowMaintenance = (tableId: string | undefined, dataRef: RefObject<WorkspaceData | undefined>, storageConflict: boolean) => {
  useEffect(() => {
    if (!tableId || storageConflict) return;
    const controller = new AbortController();
    const pointers = new Set<number>();
    let lastActivity = performance.now();
    const activity = () => { lastActivity = performance.now(); };
    const pointerDown = (event: PointerEvent) => { pointers.add(event.pointerId); activity(); };
    const pointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId); activity(); };
    const blur = () => { pointers.clear(); activity(); };
    const events = ['keydown', 'input', 'wheel', 'scroll', 'focusin'] as const;
    events.forEach(event => document.addEventListener(event, activity, { capture: true, passive: true }));
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('pointerup', pointerUp, true);
    document.addEventListener('pointercancel', pointerUp, true);
    window.addEventListener('blur', blur);
    const cancel = afterWorkspacePaint(() => {
      void maintainWorkspaceRowPages(tableId, {
        signal: controller.signal,
        isCurrent: () => dataRef.current?.nodes.find(node => node.id === dataRef.current?.activeNodeId)?.tableId === tableId,
        canRun: () => document.visibilityState === 'visible' && !pointers.size && performance.now() - lastActivity >= 1000,
      }).catch(error => {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === 'WorkspaceStorageConflictError') window.dispatchEvent(new CustomEvent('workspace-storage-error', { detail: error }));
        else console.warn('[workspace-layout-maintenance]', error);
      });
    }, true);
    return () => {
      cancel(); controller.abort();
      events.forEach(event => document.removeEventListener(event, activity, true));
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('pointerup', pointerUp, true);
      document.removeEventListener('pointercancel', pointerUp, true);
      window.removeEventListener('blur', blur);
    };
  }, [tableId, dataRef, storageConflict]);
};
