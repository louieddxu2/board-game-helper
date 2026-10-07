import { useCallback, useEffect, useLayoutEffect, useState, type SetStateAction } from 'react';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceNode } from './types';
import type { WorkspaceTableImportPreview } from './useWorkspaceActions';
import type { NameDialogState } from './workspaceShared';

export type WorkspaceCellTarget = { rowId: string; columnId: string };
interface WorkspaceDialogState {
  editing?: WorkspaceCellTarget;
  focusTarget?: WorkspaceCellTarget;
  lastPasteTarget?: WorkspaceCellTarget;
  selectionEditor?: { rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean };
  configuring?: { column: WorkspaceColumn; isRowHeader: boolean };
  workspaceImport?: WorkspaceData;
  nodeMenu?: WorkspaceNode;
  movingNode?: WorkspaceNode;
  bottomNavigationDraft?: string[];
  hiddenFieldsEditor?: { rowId: string; title: string };
  tableCreateParentId?: string | null;
  nameDialog?: NameDialogState;
  confirmDialog?: { title: string; message: string; onConfirm(): void };
  tableImportPreview?: WorkspaceTableImportPreview;
  columnVisibilityOpen: boolean;
  pasteDialogOpen: boolean;
}
const initial: WorkspaceDialogState = { columnVisibilityOpen: false, pasteDialogOpen: false };

/** Owns dialog targets and table-scoped cancellation; editors still own their drafts. */
export const useWorkspaceDialogs = (activeNodeId: string | null | undefined) => {
  const [state, setState] = useState(initial);
  const update = useCallback((change: Partial<WorkspaceDialogState> | ((current: WorkspaceDialogState) => Partial<WorkspaceDialogState>)) => {
    setState(current => {
      const patch = typeof change === 'function' ? change(current) : change;
      return Object.entries(patch).every(([key, value]) => Object.is(current[key as keyof WorkspaceDialogState], value)) ? current : { ...current, ...patch };
    });
  }, []);
  const set = useCallback(<K extends keyof WorkspaceDialogState>(key: K, value: SetStateAction<WorkspaceDialogState[K]>) => {
    update(current => ({ [key]: typeof value === 'function' ? (value as (previous: WorkspaceDialogState[K]) => WorkspaceDialogState[K])(current[key]) : value }));
  }, [update]);
  const close = useCallback((...keys: (keyof WorkspaceDialogState)[]) => {
    update(Object.fromEntries(keys.map(key => [key, initial[key]])));
  }, [update]);
  const closeCellEditors = useCallback(() => close('editing', 'selectionEditor'), [close]);

  useLayoutEffect(() => {
    close('editing', 'focusTarget', 'selectionEditor', 'configuring', 'columnVisibilityOpen', 'hiddenFieldsEditor', 'pasteDialogOpen', 'lastPasteTarget', 'confirmDialog', 'nameDialog');
  }, [activeNodeId, close]);
  useEffect(() => {
    if (!state.focusTarget) return;
    const timer = window.setTimeout(() => close('focusTarget'), 3000);
    return () => window.clearTimeout(timer);
  }, [state.focusTarget, close]);

  return { state, update, set, close, closeCellEditors };
};
export type WorkspaceDialogController = ReturnType<typeof useWorkspaceDialogs>;
