export type WorkspaceInputType = 'text' | 'number' | 'select' | 'dynamic-select' | 'link';
export type WorkspaceTextAlign = 'left' | 'center' | 'right';
export type WorkspaceOverflowMode = 'expand' | 'ellipsis' | 'wrap';

export interface WorkspaceLinkValue {
  url: string;
  label: string;
}

export type WorkspaceCellValue = string | number | WorkspaceLinkValue | null;

export interface WorkspaceColumn {
  id: string;
  name: string;
  inputType: WorkspaceInputType;
  options: string[];
  alignment?: WorkspaceTextAlign;
  overflowMode?: WorkspaceOverflowMode;
}

export interface WorkspaceRow {
  id: string;
  name: WorkspaceCellValue;
  values: Record<string, WorkspaceCellValue>;
}

export interface WorkspaceTable {
  id: string;
  name: string;
  rowHeaderName: string;
  rowHeader?: WorkspaceColumn;
  textScale?: number;
  transposed?: boolean;
  columns: WorkspaceColumn[];
  rows: WorkspaceRow[];
  updatedAt: number;
}

export interface WorkspaceNode {
  id: string;
  type: 'folder' | 'table';
  name: string;
  parentId: string | null;
  order: number;
  tableId?: string;
}

export interface WorkspaceData {
  version: 1;
  nodes: WorkspaceNode[];
  tables: WorkspaceTable[];
  activeNodeId: string | null;
}

export const WORKSPACE_FORMAT = 'board-game-helper-workspace';
export const WORKSPACE_FORMAT_VERSION = 1;
