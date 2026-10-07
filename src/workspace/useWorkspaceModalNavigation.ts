import { useCallback, useLayoutEffect, useRef } from 'react';
import type { useWorkspaceGoogleDriveBackup } from './googleDriveBackup/useWorkspaceGoogleDriveBackup';
import type { WorkspaceData } from './types';
import { useWorkspaceBrowserBack } from './useWorkspaceBrowserBack';
import type { useWorkspaceBulkSelection } from './useWorkspaceBulkSelection';
import type { WorkspaceDialogController } from './useWorkspaceDialogs';
import type { useWorkspaceDrawer } from './useWorkspaceDrawer';
import type { useWorkspaceFilter } from './useWorkspaceFilter';
import type { WorkspaceStorageController } from './useWorkspaceStorage';
import type { WorkspaceCloseOwner, WorkspaceRequestClose } from './workspaceModalClose';

interface WorkspaceModalNavigationOptions {
  data: WorkspaceData | undefined;
  commit: WorkspaceStorageController['commit'];
  setNotice: (message: string) => void;
  dialogs: WorkspaceDialogController;
  driveBackup: Pick<ReturnType<typeof useWorkspaceGoogleDriveBackup>, 'close' | 'dialogOpen'>;
  filter: Pick<ReturnType<typeof useWorkspaceFilter>, 'filterTarget' | 'setFilterTarget'>;
  bulk: Pick<ReturnType<typeof useWorkspaceBulkSelection>, 'bulkEditorOpen' | 'setBulkEditorOpen' | 'bulkSelection' | 'closeBulkSelection'>;
  drawer: Pick<ReturnType<typeof useWorkspaceDrawer>, 'drawerOpen' | 'closeDrawer'>;
  editBarOpen: boolean;
  setEditBarOpen: (open: boolean) => void;
  tableActionsOpen: boolean;
  setTableActionsOpen: (open: boolean) => void;
  searchActive: boolean;
  clearSearchAndFilters: () => void;
}

export const useWorkspaceModalNavigation = ({ data, commit, setNotice, dialogs, driveBackup, filter, bulk, drawer, editBarOpen, setEditBarOpen, tableActionsOpen, setTableActionsOpen, searchActive, clearSearchAndFilters }: WorkspaceModalNavigationOptions) => {
  const { state, update, close } = dialogs;
  const closeBottomNavigationDialog = useCallback(() => {
    if (!data || state.bottomNavigationDraft === undefined) return;
    const validTableIds = new Set(data.tables.map(item => item.id));
    const nextIds = [...new Set(state.bottomNavigationDraft)].filter(id => validTableIds.has(id));
    if (JSON.stringify(nextIds) !== JSON.stringify(data.bottomNavigationTableIds ?? [])) {
      commit({ ...data, bottomNavigationTableIds: nextIds });
      setNotice('底部導覽列已更新');
    }
    update({ bottomNavigationDraft: undefined });
  }, [state.bottomNavigationDraft, commit, data, update, setNotice]);

  // One ordered list owns both Back priority and the matching cancellation action.
  const layers: [WorkspaceCloseOwner, boolean, () => void][] = [
    ['google-drive', driveBackup.dialogOpen, driveBackup.close],
    ['confirm', Boolean(state.confirmDialog), () => close('confirmDialog')],
    ['workspace-import', Boolean(state.workspaceImport), () => close('workspaceImport')],
    ['table-import', Boolean(state.tableImportPreview), () => close('tableImportPreview')],
    ['paste', state.pasteDialogOpen, () => close('pasteDialogOpen')],
    ['hidden-fields', Boolean(state.hiddenFieldsEditor), () => close('hiddenFieldsEditor')],
    ['bulk-editor', bulk.bulkEditorOpen, () => bulk.setBulkEditorOpen(false)],
    ['filter', Boolean(filter.filterTarget), () => filter.setFilterTarget(undefined)],
    ['column-config', Boolean(state.configuring), () => close('configuring')],
    ['selection-editor', Boolean(state.selectionEditor), () => close('selectionEditor')],
    ['cell-editor', Boolean(state.editing), () => close('editing')],
    ['move-node', Boolean(state.movingNode), () => close('movingNode')],
    ['node-menu', Boolean(state.nodeMenu), () => close('nodeMenu')],
    ['table-create', state.tableCreateParentId !== undefined, () => close('tableCreateParentId')],
    ['name-editor', Boolean(state.nameDialog), () => close('nameDialog')],
    ['bottom-navigation', state.bottomNavigationDraft !== undefined, closeBottomNavigationDialog],
    ['column-visibility', state.columnVisibilityOpen, () => close('columnVisibilityOpen')],
    ['table-actions', tableActionsOpen, () => setTableActionsOpen(false)],
    ['drawer', drawer.drawerOpen, drawer.closeDrawer],
    ['bulk-selection', Boolean(bulk.bulkSelection), bulk.closeBulkSelection],
    ['edit-bar', editBarOpen, () => setEditBarOpen(false)],
    ['search', searchActive, clearSearchAndFilters],
  ];
  const latest = useRef(layers);
  useLayoutEffect(() => { latest.current = layers; });
  const requestClose = useCallback<WorkspaceRequestClose>((owner, reason, onDismiss) => {
    if (reason !== 'browser-back') onDismiss?.();
    else latest.current.find(([id]) => id === owner)?.[2]();
  }, []);
  const active = layers.find(([, open]) => open)?.[0];
  useWorkspaceBrowserBack({ active: Boolean(active), onBack: () => { if (active) requestClose(active, 'browser-back'); } });
  return { requestClose, closeBottomNavigationDialog };
};
