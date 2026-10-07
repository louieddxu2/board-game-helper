import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect } from 'react';
import { type WorkspaceBulkSelection } from './bulkEdit';
import type { useWorkspaceGoogleDriveBackup } from './googleDriveBackup/useWorkspaceGoogleDriveBackup';
import type { WorkspaceCommitOptions, WorkspaceTableMutation } from './history';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceNode } from './types';
import { type WorkspaceTableImportPreview } from './useWorkspaceActions';
import { useWorkspaceBrowserBack } from './useWorkspaceBrowserBack';
import { type WorkspaceRequestClose } from './workspaceModalClose';
import { NameDialogState, type HeaderFilterTarget } from './workspaceShared';

interface WorkspaceModalNavigationOptions {
  data: WorkspaceData | undefined;
  bottomNavigationDraft: string[] | undefined;
  commit: (next: WorkspaceData, explicitMutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => void;
  setNotice: Dispatch<SetStateAction<string>>;
  setBottomNavigationDraft: Dispatch<SetStateAction<string[] | undefined>>;
  driveBackup: Pick<ReturnType<typeof useWorkspaceGoogleDriveBackup>, 'close' | 'dialogOpen'>;
  confirmDialog: { title: string; message: string; onConfirm(): void; } | undefined;
  workspaceImport: WorkspaceData | undefined;
  tableImportPreview: WorkspaceTableImportPreview | undefined;
  pasteDialogOpen: boolean;
  hiddenFieldsEditor: { rowId: string; title: string; } | undefined;
  bulkEditorOpen: boolean;
  filterTarget: HeaderFilterTarget | undefined;
  configuring: { column: WorkspaceColumn; isRowHeader: boolean; } | undefined;
  selectionEditor: { rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean; } | undefined;
  editing: { rowId: string; columnId: string; } | undefined;
  movingNode: WorkspaceNode | undefined;
  nodeMenu: WorkspaceNode | undefined;
  tableCreateParentId: string | null | undefined;
  nameDialog: NameDialogState | undefined;
  columnVisibilityOpen: boolean;
  tableActionsOpen: boolean;
  drawerOpen: boolean;
  bulkSelection: WorkspaceBulkSelection | undefined;
  editBarOpen: boolean;
  searchOpen: boolean;
  hasActiveSearchState: boolean;
  setConfirmDialog: Dispatch<SetStateAction<{ title: string; message: string; onConfirm(): void; } | undefined>>;
  setWorkspaceImport: Dispatch<SetStateAction<WorkspaceData | undefined>>;
  setTableImportPreview: Dispatch<SetStateAction<WorkspaceTableImportPreview | undefined>>;
  setPasteDialogOpen: Dispatch<SetStateAction<boolean>>;
  setHiddenFieldsEditor: Dispatch<SetStateAction<{ rowId: string; title: string; } | undefined>>;
  setBulkEditorOpen: Dispatch<SetStateAction<boolean>>;
  setFilterTarget: Dispatch<SetStateAction<HeaderFilterTarget | undefined>>;
  setConfiguring: Dispatch<SetStateAction<{ column: WorkspaceColumn; isRowHeader: boolean; } | undefined>>;
  setSelectionEditor: Dispatch<SetStateAction<{ rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean; } | undefined>>;
  setEditing: Dispatch<SetStateAction<{ rowId: string; columnId: string; } | undefined>>;
  setMovingNode: Dispatch<SetStateAction<WorkspaceNode | undefined>>;
  setNodeMenu: Dispatch<SetStateAction<WorkspaceNode | undefined>>;
  setTableCreateParentId: Dispatch<SetStateAction<string | null | undefined>>;
  setNameDialog: Dispatch<SetStateAction<NameDialogState | undefined>>;
  setColumnVisibilityOpen: Dispatch<SetStateAction<boolean>>;
  setTableActionsOpen: Dispatch<SetStateAction<boolean>>;
  closeDrawer: () => void;
  closeBulkSelection: () => void;
  setEditBarOpen: Dispatch<SetStateAction<boolean>>;
  clearSearchAndFilters: () => void;
  focusTarget: { rowId: string; columnId: string; } | undefined;
  setFocusTarget: Dispatch<SetStateAction<{ rowId: string; columnId: string; } | undefined>>;
}

export const useWorkspaceModalNavigation = ({ data, bottomNavigationDraft, commit, setNotice, setBottomNavigationDraft, driveBackup, confirmDialog, workspaceImport, tableImportPreview, pasteDialogOpen, hiddenFieldsEditor, bulkEditorOpen, filterTarget, configuring, selectionEditor, editing, movingNode, nodeMenu, tableCreateParentId, nameDialog, columnVisibilityOpen, tableActionsOpen, drawerOpen, bulkSelection, editBarOpen, searchOpen, hasActiveSearchState, setConfirmDialog, setWorkspaceImport, setTableImportPreview, setPasteDialogOpen, setHiddenFieldsEditor, setBulkEditorOpen, setFilterTarget, setConfiguring, setSelectionEditor, setEditing, setMovingNode, setNodeMenu, setTableCreateParentId, setNameDialog, setColumnVisibilityOpen, setTableActionsOpen, closeDrawer, closeBulkSelection, setEditBarOpen, clearSearchAndFilters, focusTarget, setFocusTarget }: WorkspaceModalNavigationOptions) => {
  const closeBottomNavigationDialog = useCallback(() => {
    if (!data || bottomNavigationDraft === undefined) return;
    const validTableIds = new Set(data.tables.map((item) => item.id));
    const nextIds = [...new Set(bottomNavigationDraft)].filter((tableId) => validTableIds.has(tableId));
    if (JSON.stringify(nextIds) !== JSON.stringify(data.bottomNavigationTableIds ?? [])) {
      commit({ ...data, bottomNavigationTableIds: nextIds });
      setNotice('底部導覽列已更新');
    }
    setBottomNavigationDraft(undefined);
  }, [bottomNavigationDraft, commit, data]);

  const browserBackLayer = driveBackup.dialogOpen
    ? 'google-drive'
    : confirmDialog
      ? 'confirm'
      : workspaceImport
        ? 'workspace-import'
        : tableImportPreview
          ? 'table-import'
          : pasteDialogOpen
            ? 'paste'
            : hiddenFieldsEditor
              ? 'hidden-fields'
              : bulkEditorOpen
                ? 'bulk-editor'
                : filterTarget
                  ? 'filter'
                  : configuring
                    ? 'column-config'
                    : selectionEditor
                      ? 'selection-editor'
                      : editing
                        ? 'cell-editor'
                        : movingNode
                          ? 'move-node'
                          : nodeMenu
                            ? 'node-menu'
                            : tableCreateParentId !== undefined
                              ? 'table-create'
                              : nameDialog
                                ? 'name-editor'
                                : bottomNavigationDraft !== undefined
                                  ? 'bottom-navigation'
                                : columnVisibilityOpen
                                  ? 'column-visibility'
                                  : tableActionsOpen
                                    ? 'table-actions'
                                    : drawerOpen
                                      ? 'drawer'
                                      : bulkSelection
                                        ? 'bulk-selection'
                                        : editBarOpen
                                          ? 'edit-bar'
                                          : searchOpen || hasActiveSearchState
                                            ? 'search'
                                            : undefined;

  const requestClose = useCallback<WorkspaceRequestClose>((owner, reason, onDismiss) => {
    if (reason !== 'browser-back') {
      onDismiss?.();
      return;
    }
    switch (owner) {
      case 'google-drive': driveBackup.close(); break;
      case 'confirm': setConfirmDialog(undefined); break;
      case 'workspace-import': setWorkspaceImport(undefined); break;
      case 'table-import': setTableImportPreview(undefined); break;
      case 'paste': setPasteDialogOpen(false); break;
      case 'hidden-fields': setHiddenFieldsEditor(undefined); break;
      case 'bulk-editor': setBulkEditorOpen(false); break;
      case 'filter': setFilterTarget(undefined); break;
      case 'column-config': setConfiguring(undefined); break;
      case 'selection-editor': setSelectionEditor(undefined); break;
      case 'cell-editor': setEditing(undefined); break;
      case 'move-node': setMovingNode(undefined); break;
      case 'node-menu': setNodeMenu(undefined); break;
      case 'table-create': setTableCreateParentId(undefined); break;
      case 'name-editor': setNameDialog(undefined); break;
      case 'bottom-navigation': closeBottomNavigationDialog(); break;
      case 'column-visibility': setColumnVisibilityOpen(false); break;
      case 'table-actions': setTableActionsOpen(false); break;
      case 'drawer': closeDrawer(); break;
      case 'bulk-selection': closeBulkSelection(); break;
      case 'edit-bar': setEditBarOpen(false); break;
      case 'search': clearSearchAndFilters(); break;
      default: break;
    }
  }, [clearSearchAndFilters, closeBottomNavigationDialog, closeBulkSelection, closeDrawer, driveBackup]);

  useWorkspaceBrowserBack({ active: Boolean(browserBackLayer), onBack: () => { if (browserBackLayer) requestClose(browserBackLayer, 'browser-back'); } });

  useEffect(() => {
    if (!focusTarget) return;
    const timer = window.setTimeout(() => setFocusTarget(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [focusTarget]);

  return { requestClose, closeBottomNavigationDialog };
};
