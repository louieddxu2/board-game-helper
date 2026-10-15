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

export interface WorkspaceDynamicOptions {
  version: 1;
  sourceRevision: string;
  isMultiple: boolean;
  counts: Array<{ key: string; count: number; spellings: Array<[string, number]> }>;
}

export interface WorkspaceFormula {
  version: 1;
  expression: string;
  variables: Record<string, { columnId: string }>;
  /** Round the final numeric result; omitted preserves its original precision. */
  decimalPlaces?: number;
}

export interface WorkspaceColumn {
  id: string;
  name: string;
  inputType: WorkspaceInputType;
  /** Same-row arithmetic; results are derived and never stored in row.values. */
  formula?: WorkspaceFormula;
  numberInputMode?: WorkspaceNumberInputMode;
  options: string[];
  /** Persisted frequency statistics owned by a dynamic-list column. */
  dynamicOptions?: WorkspaceDynamicOptions;
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
  /** Changes on local mutations, including undo and imports; independent of wall-clock time. */
  changeRevision?: string;
  name: string;
  rowHeaderName: string;
  rowHeader?: WorkspaceColumn;
  textScale?: number;
  /** Legacy view preference retained for backup compatibility; currently ignored by the UI. */
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
  /** Revision of navigation and folder structure, separate from table edits. */
  structureRevision?: string;
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
