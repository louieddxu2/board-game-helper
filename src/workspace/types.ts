export type WorkspaceInputType = 'text' | 'number' | 'select' | 'dynamic-select' | 'link' | 'datetime';
export type WorkspaceNumberInputMode = 'input' | 'adjust' | 'step';
export type WorkspaceTextAlign = 'left' | 'center' | 'right';
export type WorkspaceOverflowMode = 'expand' | 'ellipsis' | 'wrap';

export interface WorkspaceLinkValue {
  url: string;
  label: string;
}

export interface WorkspaceNumberRange {
  min: number | null;
  max: number | null;
  color: string;
}

export type WorkspaceCellValue = string | number | WorkspaceLinkValue | null;

export interface WorkspaceColumn {
  id: string;
  name: string;
  inputType: WorkspaceInputType;
  numberInputMode?: WorkspaceNumberInputMode;
  options: string[];
  optionColors?: Record<string, string>;
  numberRanges?: WorkspaceNumberRange[];
  hidden?: boolean;
  isMultiple?: boolean;
  alignment?: WorkspaceTextAlign;
  overflowMode?: WorkspaceOverflowMode;
  widthLimitChars?: number;
  lineLimit?: number;
  dateOnly?: boolean;
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
  /** Monotonic local revision for changes that are not owned by one table (for example folder moves). */
  updatedAt?: number;
  nodes: WorkspaceNode[];
  tables: WorkspaceTable[];
  activeNodeId: string | null;
  /** Ordered table ids shown in the Workspace bottom navigation. */
  bottomNavigationTableIds?: string[];
}

export const WORKSPACE_FORMAT = 'board-game-helper-workspace';
export const WORKSPACE_FORMAT_VERSION = 1;
