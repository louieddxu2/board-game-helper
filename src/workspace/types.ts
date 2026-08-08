export type WorkspaceInputType = 'text' | 'number' | 'select' | 'dynamic-select';
export type WorkspaceCellValue = string | number | null;

export interface WorkspaceColumn {
  id: string;
  name: string;
  inputType: WorkspaceInputType;
  options: string[];
}

export interface WorkspaceRow {
  id: string;
  values: Record<string, WorkspaceCellValue>;
}

export interface WorkspaceTable {
  id: string;
  name: string;
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
