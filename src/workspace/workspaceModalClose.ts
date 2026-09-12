import { createContext } from 'react';

export type WorkspaceModalCloseReason = 'close-button' | 'backdrop' | 'escape' | 'browser-back';

export type WorkspaceModalOwner =
  | 'google-drive' | 'confirm' | 'workspace-import' | 'table-import' | 'paste'
  | 'hidden-fields' | 'bulk-editor' | 'filter' | 'column-config' | 'selection-editor'
  | 'cell-editor' | 'move-node' | 'node-menu' | 'table-create' | 'name-editor'
  | 'bottom-navigation' | 'column-visibility' | 'table-actions';

export type WorkspaceCloseOwner = WorkspaceModalOwner | 'drawer' | 'bulk-selection' | 'edit-bar' | 'search';

/** Draft owners keep their save logic; browser Back uses the page's cancellation policy. */
export type WorkspaceRequestClose = (
  owner: WorkspaceCloseOwner,
  reason: WorkspaceModalCloseReason,
  onDismiss?: () => void,
) => void;

export const WorkspaceModalCloseContext = createContext<WorkspaceRequestClose | undefined>(undefined);
